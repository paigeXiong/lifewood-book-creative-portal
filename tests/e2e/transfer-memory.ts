// Windows-only opt-in diagnostic. No memory budget is asserted from a single run.
import { chromium, expect, test, type CDPSession, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { gotoInAccountLocale } from "./auth-request";

const execute = promisify(execFile);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type UrlProbe = { created: number; revoked: number; live: Record<string, number> };
type ProbeWindow = Window & { __deliveryUrls: UrlProbe };

async function snapshot(page: Page, renderer: CDPSession, browser: CDPSession) {
  const { processInfo } = await browser.send("SystemInfo.getProcessInfo");
  const ids = processInfo.map(process => process.id).filter(Number.isSafeInteger);
  if (!ids.length) throw new Error("No test browser process IDs");
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-Command",
    `Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress`
  ], { windowsHide: true, timeout: 10_000 });
  const parsed = JSON.parse(stdout);
  const processes = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ Id: number; PrivateMemorySize64: number; WorkingSet64: number }>;
  if (!processes.length) throw new Error("Missing process memory samples");
  const { metrics } = await renderer.send("Performance.getMetrics");
  const metric = (name: string) => metrics.find(entry => entry.name === name)?.value;
  const dom = await renderer.send("Memory.getDOMCounters");
  const urls = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__deliveryUrls;
    return { created: probe.created, revoked: probe.revoked, liveCount: Object.keys(probe.live).length, liveBytes: Object.values(probe.live).reduce((sum, n) => sum + n, 0) };
  });
  return {
    processes, requestedProcessIds: ids, missingProcessIds: ids.filter(id => !processes.some(process => process.Id === id)),
    processTypes: processInfo.map(process => ({ id: process.id, type: process.type })),
    privateBytes: processes.reduce((sum, p) => sum + p.PrivateMemorySize64, 0),
    workingSetBytes: processes.reduce((sum, p) => sum + p.WorkingSet64, 0),
    jsHeapUsedBytes: metric("JSHeapUsedSize"), jsHeapTotalBytes: metric("JSHeapTotalSize"), dom, urls,
  };
}

export async function diagnoseTransferMemory(source: Page, projectId: string, filePath: string, root: string, expectedHash: string, faultUrl: string, faultResponse: () => {count:number;bytes:number}) {
  if (process.platform !== "win32") throw new Error("Transfer memory diagnostic requires Windows process counters");
  test.setTimeout(test.info().timeout + 360_000);
  // Incognito OPFS is memory-backed. Use a fresh on-disk profile for both modes.
  // Playwright owns and removes the temporary profile when the context closes.
  const context = await chromium.launchPersistentContext("", { headless: true, acceptDownloads: true });
  const browser = context.browser()!;
  const started = Date.now();
  let phase = "initializing", stop = false;
  const samples: Array<Record<string, unknown>> = [], sampleErrors: string[] = [];
  const checks: Array<Record<string, unknown>> = [];
  const report: Record<string, unknown> = { startedAt: new Date(started).toISOString(), browser: browser.version(), fileBytes: 500_000_000, checks, samples, sampleErrors };
  const streaming = process.env.LW_DOWNLOAD_STREAMING === "1";
  report.mode = streaming ? "stream-to-file-with-test-picker" : "blob-compatibility";
  report.storageProfile = "temporary-on-disk";
  let sampler: Promise<void> | undefined;
  let diagnosticPage: Page | undefined;
  try {
    await context.addCookies((await source.context().storageState()).cookies);
    // The OS save dialog is not automated: provide real writable test files in OPFS.
    // Production does not use OPFS. Baseline explicitly selects the compatibility path.
    await context.addInitScript((streaming) => {
      const state = window as unknown as { __savedTargets: string[]; showSaveFilePicker?: () => Promise<FileSystemFileHandle> };
      state.__savedTargets = [];
      state.showSaveFilePicker = streaming ? async () => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("stream-test", {create:true});
        const name = crypto.randomUUID();
        const handle = await directory.getFileHandle(name, {create:true});
        const writer = await handle.createWritable(); await writer.write("existing test file"); await writer.close();
        state.__savedTargets.push(name);
        return handle;
      } : undefined;
    }, streaming);
    // Store only numbers/URL strings, never Blob references. Observe native URL lifetime.
    await context.addInitScript(() => {
      const probe: UrlProbe = { created: 0, revoked: 0, live: {} };
      (window as unknown as ProbeWindow).__deliveryUrls = probe;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => {
        const url = create(value);
        if (value instanceof Blob) { probe.live[url] = value.size; probe.created++; }
        return url;
      };
      URL.revokeObjectURL = url => {
        if (url in probe.live) { delete probe.live[url]; probe.revoked++; }
        revoke(url);
      };
    });
    const page = diagnosticPage = await context.newPage();
    const failedRequests: Array<{url:string;failure:unknown}> = [];
    report.failedRequests = failedRequests;
    page.on("requestfailed", request => { if (request.url().includes("/api/")) failedRequests.push({url:request.url(),failure:request.failure()}); });
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/zh-CN/tasks/${projectId}`);
    const renderer = await context.newCDPSession(page), system = await browser.newBrowserCDPSession();
    await renderer.send("Performance.enable");
    await renderer.send("Network.enable");
    const section = page.locator(".customer-delivery");
    const downloadButton = section.getByRole("button", { name: "下载最终成品", exact: true });
    await expect(downloadButton).toBeVisible();
    const sample = async () => {
      const observedPhase = phase, elapsedMs = Date.now() - started;
      const value = await snapshot(page, renderer, system);
      samples.push({ elapsedMs, phase: observedPhase, phaseAtEnd: phase, stablePhase: observedPhase === phase, ...value });
    };
    sampler = (async () => { while (!stop) { try { await sample(); } catch (error) { sampleErrors.push(String(error)); } if (!stop) await pause(1000); } })();
    phase = "baseline"; await pause(10_000);

    let responseSeen = false, requestId = "";
    const cancelled = new Set<string>();
    renderer.on("Network.requestWillBeSent", event => { if (new URL(event.request.url).pathname === filePath) requestId = event.requestId; });
    renderer.on("Network.responseReceived", event => { if (new URL(event.response.url).pathname === filePath) responseSeen = true; });
    renderer.on("Network.loadingFailed", event => { if (event.canceled) cancelled.add(event.requestId); });
    const normal = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    for (let cycle = 1; cycle <= 3; cycle++) {
      phase = `cancel-${cycle}-receiving`; responseSeen = false;
      await renderer.send("Network.emulateNetworkConditions", { ...normal, latency: 120, downloadThroughput: 2_000_000 });
      await downloadButton.click();
      await expect.poll(() => responseSeen).toBe(true);
      await pause(4000);
      const activeId = requestId;
      if (cycle === 3) {
        // SPA navigation exercises component cleanup without resetting the URL probe.
        await page.getByRole("link", { name: "项目", exact: true }).click();
        await expect(page).toHaveURL(new RegExp("/zh-CN/tasks$"));
      } else await section.getByRole("button", { name: "取消", exact: true }).click();
      await expect.poll(() => cancelled.has(activeId)).toBe(true);
      await renderer.send("Network.emulateNetworkConditions", normal);
      phase = `cancel-${cycle}-idle`; await pause(10_000);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__deliveryUrls.created)).toBe(0);
      if (streaming) expect(await page.evaluate(async () => {
        const names = (window as unknown as {__savedTargets:string[]}).__savedTargets;
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("stream-test");
        return (await (await directory.getFileHandle(names.at(-1)!)).getFile()).text();
      })).toBe("existing test file");
      checks.push({ case: cycle === 3 ? "SPA navigation aborts request" : "cancel aborts request", cycle });
      console.info(`[transfer-memory] cancel/navigation cycle ${cycle} complete`);
    }
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/zh-CN/tasks/${projectId}`);
    await expect(downloadButton).toBeVisible();
    phase = "complete-baseline"; await pause(10_000);
    const verifySavedFile = async (name: string) => {
      const event = page.waitForEvent("download", {timeout:120_000});
      await page.evaluate(async name => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("stream-test");
        const file = await (await directory.getFileHandle(name)).getFile();
        const url = URL.createObjectURL(file), link = document.createElement("a");
        link.href=url;link.download="integrity-check.mp4";document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30_000);
      },name);
      const download = await event, path=(await download.path())!;
      expect((await stat(path)).size).toBe(500_000_000);
      const digest=createHash("sha256");for await(const chunk of createReadStream(path))digest.update(chunk);
      expect(digest.digest("hex")).toBe(expectedHash);
      await download.delete();
    };
    for (let cycle = 1; cycle <= 3; cycle++) {
      phase = `complete-${cycle}-receiving`;
      if (streaming) {
        await downloadButton.click();
        await expect(section.getByText("文件已保存到所选位置。", {exact:true})).toBeVisible({timeout:120_000});
        // Do not create a File/Blob snapshot of the saved output while measuring.
        // Actual size and hash are verified after sampling has stopped.
        expect(await page.evaluate(() => (window as unknown as ProbeWindow).__deliveryUrls.created)).toBe(0);
      } else {
        const pending = page.waitForEvent("download", { timeout: 120_000 });
        await downloadButton.click(); const download = await pending;
        const path = await download.path(); expect(path).toBeTruthy();
        expect((await stat(path!)).size).toBe(500_000_000);
        phase = `complete-${cycle}-url-held`;
        await pause(5000);
        expect(await page.evaluate(() => Object.values((window as unknown as ProbeWindow).__deliveryUrls.live))).toEqual([500_000_000]);
        await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as ProbeWindow).__deliveryUrls.live).length), { timeout: 40_000 }).toBe(0);
      }
      phase = `complete-${cycle}-idle`;
      await pause(cycle === 3 ? 60_000 : 10_000);
      checks.push({ case: streaming ? "streamed save commits without Blob URL" : "complete download releases object URL", cycle, fileBytes: 500_000_000 });
      console.info(`[transfer-memory] completed download ${cycle}; ${streaming ? "file committed without Blob URL" : "object URL released"} and idle observed`);
    }
    await page.getByRole("link", { name: "项目", exact: true }).click();
    phase = "after-navigation-idle"; await pause(15_000);
    const urlResult = await page.evaluate(() => (window as unknown as ProbeWindow).__deliveryUrls);
    expect(urlResult.created).toBe(streaming ? 0 : 3); expect(urlResult.revoked).toBe(streaming ? 0 : 3); expect(urlResult.live).toEqual({});
    report.urlResult = urlResult;
    stop=true;await sampler;
    // Export test output only after sampling stops; integrity extraction is not product memory.
    if (streaming) {
      const names=await page.evaluate(()=>(window as unknown as {__savedTargets:string[]}).__savedTargets);
      expect(names).toHaveLength(3);
      for(const name of names)await verifySavedFile(name);
      checks.push({case:"three saved files match SHA-256",sha256:expectedHash});
      for(const locale of ["zh-CN","en-US"]){
        await gotoInAccountLocale(page,`http://127.0.0.1:5193/${locale}/tasks/${projectId}`);
        const button=section.getByRole("button",{name:locale==="zh-CN"?"下载最终成品":"Download final video",exact:true});
        await page.route(`**${filePath}`,route=>route.continue({url:faultUrl}));
        const previousFaultCount=faultResponse().count;
        await button.click();await expect(section.getByRole("alert")).toBeVisible();
        const interrupted=faultResponse();
        expect(interrupted.count).toBeGreaterThan(previousFaultCount);
        expect(interrupted.bytes).toBe(262144);
        expect(await page.evaluate(async()=>{
          const names=(window as unknown as {__savedTargets:string[]}).__savedTargets;
          const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle("stream-test");
          return (await(await directory.getFileHandle(names.at(-1)!)).getFile()).text();
        })).toBe("existing test file");
        await page.screenshot({path:resolve(root,`stream-error-${locale}.png`)});
        await page.unroute(`**${filePath}`);await button.click();
        await expect(section.getByText(locale==="zh-CN"?"文件已保存到所选位置。":"Your file has been saved to the selected location.",{exact:true})).toBeVisible({timeout:120_000});
        const name=await page.evaluate(()=>(window as unknown as {__savedTargets:string[]}).__savedTargets.at(-1)!);
        await verifySavedFile(name);checks.push({case:"interruption preserves existing file; retry hash matches",locale,bytesBeforeDisconnect:interrupted.bytes,sha256:expectedHash});
      }
    }
    expect(samples.filter(entry => entry.phase === "baseline").length).toBeGreaterThanOrEqual(3);
    report.checksPassed = true;
  } catch (error) {
    report.error = String(error);
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      report.failureState = await diagnosticPage.locator(".customer-delivery").innerText({timeout:2000}).catch(()=>"unavailable");
      report.storage = await diagnosticPage.evaluate(()=>navigator.storage.estimate()).catch(()=>undefined);
      await diagnosticPage.screenshot({path:resolve(root,"memory-failure.png")}).catch(()=>{});
    }
    throw error;
  }
  finally {
    stop = true; await sampler;
    try { await context.close(); } catch (error) { report.closeError = String(error); }
    report.finishedAt = new Date().toISOString();
    report.passed = report.checksPassed === true && sampleErrors.length === 0 && !report.closeError;
    await writeFile(resolve(root, "memory-report.json"), JSON.stringify(report, null, 2));
    expect(report.passed, `Memory diagnostic failed: ${report.error ?? report.closeError ?? sampleErrors.join("; ")}`).toBe(true);
  }
}
