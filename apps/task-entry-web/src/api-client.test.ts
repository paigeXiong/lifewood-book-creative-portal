import { afterEach, describe, expect, it, vi } from "vitest";
import { optionService, projectService } from "@lifewood/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("sends locale and credentials for dynamic options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ taskStatuses: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await optionService.getFormOptions("en-US");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Accept-Language")).toBe("en-US");
  });

  it("normalizes API error responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "project.version_conflict", fallbackMessage: "Conflict", retryable: true,
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(optionService.getFormOptions("zh-CN")).rejects.toMatchObject({
      details: { code: "project.version_conflict", retryable: true },
    });
  });

  it("runs preflight validation and sends the idempotency key on submit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, fieldErrors: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "p1", status: "submitted" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await projectService.validateProject("p1", 7, "zh-CN");
    await projectService.submitProject("p1", 7, "0123456789abcdef0123456789abcdef", "zh-CN");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects/p1/validate");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ version: 7 });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/projects/p1/submit");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ version: 7, idempotencyKey: "0123456789abcdef0123456789abcdef" });
  });
});
