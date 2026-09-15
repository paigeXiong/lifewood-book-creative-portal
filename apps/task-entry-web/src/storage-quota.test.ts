import { afterEach, describe, expect, it, vi } from "vitest";
import { localizedApiError, projectService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
afterEach(() => vi.unstubAllGlobals());
describe("storage quota recovery", () => {
  it.each([
    ["zh-CN", "平台存储空间已满，请联系管理员处理。"],
    ["en-US", "Platform storage is full. Contact an administrator."],
  ] as const)("shows a localized quota error and allows explicit upload retry in %s", async (locale, message) => {
    let full = true;
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input.endsWith("/auth/csrf")) return new Response(JSON.stringify({ token: "quota-csrf" }));
      return full
        ? new Response(JSON.stringify({ code: "storage.quota", messageKey: "errors.storage.quota", fallbackMessage: "Storage full", retryable: true }), { status: 507 })
        : new Response(JSON.stringify({ draft: { version: 5 }, asset: { id: "recovered" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([0x89, 0x50])], "quota.png", { type: "image/png" });
    const attempt = () => projectService.uploadAsset("quota-project", 4, "supplemental-images", file, locale);
    const error = await attempt().catch(error => error);
    expect(error).toMatchObject({ details: { code: "storage.quota", retryable: true } });
    expect(localizedApiError(error, i18n.getFixedT(locale))).toBe(message);
    const uploads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/files?"));
    expect(uploads()).toHaveLength(1);
    full = false;
    await expect(attempt()).resolves.toMatchObject({ asset: { id: "recovered" } });
    expect(uploads()).toHaveLength(2);
    const options = uploads()[1][1] as RequestInit;
    expect(new Headers(options.headers).get("Accept-Language")).toBe(locale);
    expect((options.body as FormData).get("file")).toBe(file);
  });

});
