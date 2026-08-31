import { afterEach, describe, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";

describe("final delivery upload cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not start the upload when cancelled while CSRF is loading", async () => {
    let finishCsrf!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishCsrf = resolve; })));
    const xhr = vi.fn();
    vi.stubGlobal("XMLHttpRequest", xhr);
    const controller = new AbortController();

    const result = adminService.publishFinalDelivery(
      "project-1",
      new File(["video"], "final.mp4", { type: "video/mp4" }),
      "Ready",
      { signal: controller.signal },
    );
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr).not.toHaveBeenCalled();
    finishCsrf(new Response(JSON.stringify({ token: "csrf" }), { status: 200 }));
  });

  it.each(["null", "{}"])("rejects malformed upload error payload %s with a safe API error", async (responseText) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ token: "csrf" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    const xhr = {
      upload: {} as XMLHttpRequestUpload,
      status: 500,
      statusText: "Internal details that must not be displayed",
      responseText,
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      withCredentials: false,
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
    };
    xhr.send.mockImplementation(() => queueMicrotask(() => xhr.onload?.()));
    vi.stubGlobal("XMLHttpRequest", vi.fn(() => xhr));

    const result = adminService.publishFinalDelivery(
      "project-1",
      new File(["video"], "final.mp4", { type: "video/mp4" }),
      "Ready",
    );

    await expect(result).rejects.toMatchObject({
      details: { code: "http.500", messageKey: "errors.system.unexpected", retryable: true },
    });
  });
});
