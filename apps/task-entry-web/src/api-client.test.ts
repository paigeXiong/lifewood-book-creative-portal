import { afterEach, describe, expect, it, vi } from "vitest";
import { authService, localizedApiError, optionService, projectService } from "@lifewood/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("does not expose unexpected runtime error details to users", () => {
    const t = (key: string) => key === "errors.system.unexpected" ? "Safe fallback" : key;
    expect(localizedApiError(new Error("database-password=secret"), t)).toBe("Safe fallback");
  });

  it("normalizes connection failures as retryable API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(optionService.getFormOptions("zh-CN")).rejects.toMatchObject({
      details: { code: "network.unavailable", retryable: true },
    });
  });

  it("normalizes invalid success responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    await expect(optionService.getFormOptions("zh-CN")).rejects.toMatchObject({
      details: { code: "network.invalidResponse", retryable: true },
    });
  });

  it("classifies a non-JSON 401 response as an expired login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));

    await expect(optionService.getFormOptions("zh-CN")).rejects.toMatchObject({
      details: { code: "auth.unauthorized", messageKey: "errors.auth.unauthorized", retryable: false },
    });
  });

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

  it("loads authenticated project statistics from the dedicated endpoint", async () => {
    const payload = { total: 4, drafts: 1, active: 2, completed: 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(projectService.getStats()).resolves.toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/stats");
    expect(init.credentials).toBe("include");
  });

  it("sends project sort field and direction to the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], page: 1, pageSize: 10, total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await projectService.listProjects({ locale: "zh-CN", sort: "author", direction: "asc", page: 2, pageSize: 10 });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("page=2");
    expect(url).toContain("sort=author");
    expect(url).toContain("direction=asc");
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

  it("deletes only the requested draft version with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-delete" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await projectService.deleteDraft("draft/1", 9, "en-US");

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/projects/draft%2F1?version=9");
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBeTruthy();
    expect(new Headers(options.headers).get("Accept-Language")).toBe("en-US");
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

  it("updates the current user profile with CSRF protection", async () => {
    const updatedUser = { id: "u1", displayName: "Updated User", clientName: "Updated Client", phone: "123456", roles: ["customer"], permissions: [] };
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-profile" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(updatedUser), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authService.updateProfile({ displayName: "Updated User", clientName: "Updated Client", phone: "123456" })).resolves.toEqual(updatedUser);

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/me/profile");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-profile");
    expect(JSON.parse(String(options.body))).toEqual({ displayName: "Updated User", clientName: "Updated Client", phone: "123456" });
    await authService.logout();
  });

  it("persists the current user's language preference with CSRF protection", async () => {
    const updatedUser = { id: "u1", displayName: "User", locale: "en-US", roles: ["customer"], permissions: [] };
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-preferences" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(updatedUser), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authService.updatePreferences({ locale: "en-US" })).resolves.toEqual(updatedUser);

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/me/preferences");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-preferences");
    expect(JSON.parse(String(options.body))).toEqual({ locale: "en-US" });
    await authService.logout();
  });

  it("uploads and removes the real current-user avatar with CSRF protection", async () => {
    const updatedUser = { id: "u1", displayName: "User", roles: ["customer"], permissions: [], hasCustomAvatar: true };
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-avatar" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(updatedUser), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "avatar.png", { type: "image/png" });
    await authService.uploadAvatar(file);

    const [uploadUrl, uploadOptions] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(uploadUrl).toBe("/api/me/avatar");
    expect(uploadOptions.method).toBe("POST");
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    expect((uploadOptions.body as FormData).get("avatar")).toBe(file);
    expect(new Headers(uploadOptions.headers).has("Content-Type")).toBe(false);
    expect(new Headers(uploadOptions.headers).get("X-CSRF-TOKEN")).toBe("csrf-avatar");

    await authService.removeAvatar();
    const [removeUrl, removeOptions] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(removeUrl).toBe("/api/me/avatar");
    expect(removeOptions.method).toBe("DELETE");
    expect(new Headers(removeOptions.headers).get("X-CSRF-TOKEN")).toBe("csrf-avatar");
  });

  it("uploads a character reference with its real character target", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-reference" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ draft: {}, asset: {} }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([0x89, 0x50])], "character.png", { type: "image/png" });

    await projectService.uploadAsset("project/1", 4, "character-reference", file, "zh-CN", undefined, "character-7");

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const body = options.body as FormData;
    expect(url).toBe("/api/projects/project%2F1/files?categoryId=character-reference");
    expect(options.method).toBe("POST");
    expect(body.get("version")).toBe("4");
    expect(body.get("categoryId")).toBe("character-reference");
    expect(body.get("characterId")).toBe("character-7");
    expect(body.get("file")).toBe(file);
  });
});
