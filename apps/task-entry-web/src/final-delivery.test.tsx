import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError, projectService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { FinalDelivery, SupportedLocale } from "@lifewood/domain";
import { FinalDeliverySection } from "./components/FinalDeliverySection";
import * as saveTarget from "./delivery-save-target";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original: FinalDelivery = { id: "v1", projectId: "task", fileName: "original.mp4", contentType: "video/mp4", sizeBytes: 1000000, publishedAt: "2026-09-07T00:00:00Z" };

describe("current final delivery", () => {
 it.each<SupportedLocale>(["zh-CN", "en-US"])("refreshes replacement and revocation without reopening the page in %s", async locale => {
  await i18n.changeLanguage(locale);
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["project-deliveries", "task", locale], [original]);
  const replacement = { ...original, id: "v2", fileName: "replacement.mp4" };
  const get = vi.spyOn(projectService, "listDeliveries").mockResolvedValue([replacement]);
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  try {
   await act(async () => root.render(<QueryClientProvider client={client}><FinalDeliverySection projectId="task" locale={locale}/></QueryClientProvider>));
   expect(c.textContent).toContain("original.mp4");
   expect(get).not.toHaveBeenCalled();
   await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
   expect(get).toHaveBeenCalledWith("task", locale);
   expect(c.textContent).toContain("replacement.mp4");
   expect(c.textContent).not.toContain("original.mp4");
   expect(c.querySelector("button")!.textContent).toBe(i18n.t("delivery.downloadLatest"));
   get.mockResolvedValue([]);
   await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
   expect(c.querySelector("li button")).toBeNull();
   expect(c.querySelector(".customer-delivery.pending")).not.toBeNull();
   expect(c.textContent).toContain(i18n.t("delivery.pendingTitle"));
  } finally {
   await act(async () => root.unmount());
   client.clear(); c.remove(); get.mockRestore();
   focusManager.setFocused(undefined); vi.useRealTimers();
  }
 });
});


describe("delivery download recovery", () => {
 it.each<SupportedLocale>(["zh-CN", "en-US"])("keeps errors on the page and supports retry, cancellation and duplicate-click protection (%s)", async locale => {
  await i18n.changeLanguage(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["project-deliveries", "task", locale], [original]);
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  const download = vi.spyOn(projectService, "downloadDelivery");
  const urlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {configurable:true, value:vi.fn(() => "blob:delivery")});
  const savedLinks: HTMLAnchorElement[] = [];
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { savedLinks.push(this); });
  vi.useFakeTimers();
  const render = () => act(async () => root.render(<QueryClientProvider client={client}><FinalDeliverySection projectId="task" locale={locale}/></QueryClientProvider>));
  try {
   await render();
   for (const [code, messageKey] of [["file.not_found", "errors.http.notFound"], ["auth.unauthorized", "errors.auth.unauthorized"], ["network.unavailable", "errors.network.unavailable"]]) {
    download.mockRejectedValueOnce(new ApiError({code, messageKey, retryable: code.startsWith("network")}));
    await act(async () => c.querySelector<HTMLButtonElement>("li button")!.click());
    expect(c.querySelector('[role="alert"]')!.textContent).toContain(i18n.t(messageKey));
    expect(c.textContent).toContain(original.fileName);
    expect(anchorClick).not.toHaveBeenCalled();
   }
   download.mockResolvedValueOnce(new Blob(["video"], {type:"video/mp4"}));
   await act(async () => c.querySelector<HTMLButtonElement>("li button")!.click());
   expect(c.querySelector('[role="alert"]')).toBeNull();
   expect(c.textContent).toContain(i18n.t("delivery.downloadSaved"));
   expect(anchorClick).toHaveBeenCalledTimes(1);
   const link = savedLinks[0];
   expect(link.download).toBe(original.fileName);
   expect(link.href).toBe("blob:delivery");
   expect(link.isConnected).toBe(false);

   let resolve!: (blob: Blob) => void;
   download.mockImplementationOnce(() => new Promise<Blob>(r => { resolve = r; }));
   await act(async () => { const button=c.querySelector<HTMLButtonElement>("li button")!; button.click(); button.click(); });
   expect(download).toHaveBeenCalledTimes(5);
   expect(c.querySelector<HTMLButtonElement>("li button")!.disabled).toBe(true);
   expect(c.textContent).toContain(i18n.t("delivery.downloading"));
   const signal = download.mock.calls.at(-1)![3];
   await act(async () => c.querySelector<HTMLButtonElement>('[role="status"] button')!.click());
   expect(signal.aborted).toBe(true);
   await act(async () => resolve(new Blob(["late result"])));
   expect(anchorClick).toHaveBeenCalledTimes(1);
   expect(c.querySelector<HTMLButtonElement>("li button")!.disabled).toBe(false);

   download.mockImplementationOnce(() => new Promise(() => {}));
   await act(async () => c.querySelector<HTMLButtonElement>("li button")!.click());
   const unmountSignal = download.mock.calls.at(-1)![3];
   await act(async () => root.unmount());
   expect(unmountSignal.aborted).toBe(true);
  } finally {
   await act(async () => root.unmount()); client.clear(); c.remove(); download.mockRestore(); anchorClick.mockRestore(); vi.clearAllTimers(); vi.useRealTimers();
   if (urlDescriptor) Object.defineProperty(URL, "createObjectURL", urlDescriptor);
   else delete (URL as unknown as {createObjectURL?:unknown}).createObjectURL;
  }
 });
});

describe("streamed delivery interaction", () => {
 it.each<SupportedLocale>(["zh-CN", "en-US"])("handles picker cancellation, committing, errors and late account results (%s)", async locale => {
  await i18n.changeLanguage(locale);
  const client = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData(["project-deliveries","task",locale],[{...original,sizeBytes:500_000_000}]);
  const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
  const choose=vi.spyOn(saveTarget,"chooseDeliveryTarget"), stream=vi.spyOn(projectService,"downloadDeliveryTo"), legacy=vi.spyOn(projectService,"downloadDelivery");
  const createWritable=vi.fn(async()=>new WritableStream() as FileSystemWritableFileStream);
  const target={createWritable} as unknown as FileSystemFileHandle;
  const click=()=>act(async()=>c.querySelector<HTMLButtonElement>("li button")!.click());
  try {
   await act(async()=>root.render(<QueryClientProvider client={client}><FinalDeliverySection projectId="task" locale={locale}/></QueryClientProvider>));
   choose.mockRejectedValueOnce(new DOMException("dismissed","AbortError"));await click();
   expect(stream).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled();expect(c.querySelector('[role="alert"]')).toBeNull();
   choose.mockResolvedValue(target);
   let finish!:()=>void;
   stream.mockImplementationOnce(async(_p,_d,_l,_s,_w,committing)=>{committing?.();await new Promise<void>(resolve=>{finish=resolve;});});
   await click();expect(c.textContent).toContain(i18n.t("delivery.saving"));expect(c.querySelector<HTMLButtonElement>('[role="status"] button')!.disabled).toBe(true);
   await act(async()=>finish());expect(c.textContent).toContain(i18n.t("delivery.fileSaved"));expect(legacy).not.toHaveBeenCalled();
   stream.mockRejectedValueOnce(new ApiError({code:"download.save_failed",messageKey:"delivery.saveFailed",retryable:true}));
   await click();expect(c.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("delivery.saveFailed"));
   let selected!:(target:FileSystemFileHandle)=>void;
   choose.mockImplementationOnce(()=>new Promise(resolve=>{selected=resolve;}));
   await click();const writesBefore=createWritable.mock.calls.length;
   await act(async()=>window.dispatchEvent(new Event("lw-account-changed")));
   await act(async()=>selected(target));
   expect(createWritable).toHaveBeenCalledTimes(writesBefore);expect(stream).toHaveBeenCalledTimes(2);
   expect(c.textContent).not.toContain(i18n.t("delivery.fileSaved"));
  } finally {await act(async()=>root.unmount());client.clear();c.remove();choose.mockRestore();stream.mockRestore();legacy.mockRestore();}
 });
});
