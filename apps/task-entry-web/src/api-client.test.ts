import { afterEach, describe, expect, it, vi } from "vitest";
import { authService, optionService, projectService } from "@lifewood/api-client";

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
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "csrf-token" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, fieldErrors: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "p1", status: "submitted" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await projectService.validateProject("p1", 7, "zh-CN");
    await projectService.submitProject("p1", 7, "0123456789abcdef0123456789abcdef", "zh-CN");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/csrf");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/projects/p1/validate");
    expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get("X-CSRF-TOKEN")).toBe("csrf-token");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ version: 7 });

    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/projects/p1/submit");
    expect(new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).get("X-CSRF-TOKEN")).toBe("csrf-token");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ version: 7, idempotencyKey: "0123456789abcdef0123456789abcdef" });
  });

  it("changes the current password with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-account" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await authService.changePassword({ currentPassword: "old-password", newPassword: "new-password-123" });

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/me/password");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBeTruthy();
    expect(JSON.parse(String(options.body))).toEqual({ currentPassword: "old-password", newPassword: "new-password-123" });
  });
});
