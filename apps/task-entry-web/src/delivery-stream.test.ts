import { afterEach, describe, expect, it, vi } from "vitest";
import { authService, captureAccountGuard, projectService } from "@lifewood/api-client";
import { chooseDeliveryTarget, openDeliveryWriter } from "./delivery-save-target";

afterEach(() => vi.unstubAllGlobals());

describe("delivery streaming", () => {
  it("binds the account before a picker and refuses to commit after a mid-stream account change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"before"}))));
    await authService.getCurrentUser(); const guard=captureAccountGuard();
    const close=vi.fn(),abort=vi.fn();
    const destination=new WritableStream<Uint8Array>({async write(){
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"after"}))));await authService.getCurrentUser();
    },close,abort});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2]))));
    await expect(projectService.downloadDeliveryTo("p","f","en-US",new AbortController().signal,destination)).rejects.toMatchObject({details:{code:"auth.account_changed"}});
    expect(close).not.toHaveBeenCalled();expect(abort).toHaveBeenCalled();expect(guard).toThrow();
  });
  it("writes incrementally with backpressure, then commits exactly once", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const bytes: number[] = [];
    const write = vi.fn(async (chunk: Uint8Array) => { bytes.push(...chunk); if (bytes.length === 2) await gate; });
    const close = vi.fn(), abort = vi.fn();
    const destination = new WritableStream<Uint8Array>({ write, close, abort });
    const response = new Response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1,2])); controller.enqueue(new Uint8Array([3,4])); controller.close(); }}));
    const blob = vi.spyOn(response, "blob");
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
    const committing = vi.fn();
    const pending = projectService.downloadDeliveryTo("p", "f", "en-US", new AbortController().signal, destination, committing);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled(); expect(committing).not.toHaveBeenCalled();
    release(); await pending;
    expect(bytes).toEqual([1,2,3,4]); expect(blob).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(abort).not.toHaveBeenCalled();
    expect(committing).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include"); expect(init.cache).toBe("no-store"); expect(new Headers(init.headers).get("Accept-Language")).toBe("en-US");
  });

  it.each(["network", "write", "close", "permission", "cancel", "before-commit"])("aborts the destination without committing on %s failure", async failure => {
    const controller = new AbortController(), close = vi.fn(), abort = vi.fn(), cancel = vi.fn();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({start(value) {source=value;source.enqueue(new Uint8Array([1]));},cancel}));
    const destination = new WritableStream<Uint8Array>({
      async write() {
        if (failure === "write") throw new DOMException("full", "QuotaExceededError");
        if (failure === "network") source.error(new TypeError("disconnected"));
        else if (failure === "cancel") controller.abort();
        else source.close();
      },
      close() { close(); if (failure === "close") throw new Error("cannot commit"); }, abort,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure === "permission" ? new Response("{}",{status:403}) : response));
    const pending = projectService.downloadDeliveryTo("p","f","zh-CN",controller.signal,destination, failure === "before-commit" ? () => controller.abort() : undefined);
    if (["cancel","before-commit"].includes(failure)) await expect(pending).rejects.toMatchObject({name:"AbortError"});
    else await expect(pending).rejects.toMatchObject({details:{code:failure === "permission" ? "auth.forbidden" : failure === "network" ? "network.unavailable" : "download.save_failed"}});
    expect(destination.locked).toBe(false);
    expect(close).toHaveBeenCalledTimes(failure === "close" ? 1 : 0);
    // An errored sink is already terminated; its underlying abort callback need not run.
    if (["network","permission","cancel","before-commit"].includes(failure)) expect(abort).toHaveBeenCalledTimes(1);
    if (failure === "write") expect(cancel).toHaveBeenCalled();
  });
});

describe("delivery save target", () => {
  it("falls back only for unsupported/small downloads and preserves picker cancellation", async () => {
    vi.stubGlobal("isSecureContext", true);
    const picker = vi.fn().mockRejectedValue(new DOMException("dismissed", "AbortError")); vi.stubGlobal("showSaveFilePicker", picker);
    expect(await chooseDeliveryTarget("small.mp4", 1)).toBeUndefined(); expect(picker).not.toHaveBeenCalled();
    await expect(chooseDeliveryTarget("large.mp4", 500_000_000)).rejects.toMatchObject({name:"AbortError"});
    expect(picker).toHaveBeenCalledWith({suggestedName:"large.mp4"});
    picker.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(chooseDeliveryTarget("large.mp4", 500_000_000)).rejects.toMatchObject({details:{messageKey:"delivery.saveFailed"}});
    vi.stubGlobal("showSaveFilePicker", undefined); expect(await chooseDeliveryTarget("large.mp4",500_000_000)).toBeUndefined();
  });
  it("aborts a writer that arrives after cancellation without writing", async () => {
    const controller = new AbortController(), abort = vi.fn();
    let release!: (writer: FileSystemWritableFileStream) => void;
    const target = {createWritable: () => new Promise<FileSystemWritableFileStream>(resolve => {release=resolve;})} as FileSystemFileHandle;
    const pending = openDeliveryWriter(target, controller.signal); controller.abort();
    release(new WritableStream({abort}) as FileSystemWritableFileStream);
    await expect(pending).rejects.toMatchObject({name:"AbortError"}); expect(abort).toHaveBeenCalledTimes(1);
  });
});
