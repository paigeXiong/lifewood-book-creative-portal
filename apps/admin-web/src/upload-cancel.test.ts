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
});
