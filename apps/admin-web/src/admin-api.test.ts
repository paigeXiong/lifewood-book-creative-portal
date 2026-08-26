import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";

describe("administrator API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads the administrator overview from the server", async () => {
    const payload = { totalProjects: 3, unassignedProjects: 1, totalUsers: 2, activeUsers: 2, submissionStatuses: [], workflowStatuses: [], priorities: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminService.getOverview()).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/overview");
  });

  it("loads localized audit actions and sends audit filters", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "user.create", label: "Created user" }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], page: 2, pageSize: 30, total: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await adminService.listAuditActions("en-US");
    await adminService.listAuditEvents({ search: "owner", actionId: "user.create", from: "2026-08-01", to: "2026-08-26", page: 2 });

    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("Accept-Language")).toBe("en-US");
    const url = String(fetchMock.mock.calls[1]?.[0]);
    expect(url).toContain("search=owner");
    expect(url).toContain("actionId=user.create");
    expect(url).toContain("from=2026-08-01");
    expect(url).toContain("to=2026-08-26");
    expect(url).toContain("page=2");
  });

  it("sends project filters to the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await adminService.listProjects({ workflowStatus: "contacting", priority: "high", search: "book", page: 2 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("workflowStatus=contacting");
    expect(String(fetchMock.mock.calls[0][0])).toContain("priority=high");
    expect(String(fetchMock.mock.calls[0][0])).toContain("search=book");
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=2");
  });

  it("protects workflow changes with CSRF and sends admin metadata only", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workflowStatus: "confirmed", priority: "urgent" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await adminService.updateWorkflow("project-1", "confirmed", "urgent", "admin-1");
    const request = fetchMock.mock.calls[1];
    const options = request[1] as RequestInit;
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-admin");
    expect(JSON.parse(String(options.body))).toEqual({ workflowStatus: "confirmed", priority: "urgent", assigneeUserId: "admin-1" });
  });

  it("withdraws a delivery with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await adminService.revokeFinalDelivery("project-1", "delivery-1");
    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain("/admin/projects/project-1/deliveries/delivery-1");
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBeTruthy();
  });

  it("resets a user password with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await adminService.resetUserPassword("customer-1", "temporary-password");

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/admin/users/customer-1/password");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-admin");
    expect(JSON.parse(String(options.body))).toEqual({ newPassword: "temporary-password" });
  });

  it("saves bilingual form options with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ groupId: "genres", id: "memoir" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await adminService.saveFormOption({ groupId: "genres", id: "memoir", labelZhCn: "回忆录", labelEnUs: "Memoir", enabled: true, sortOrder: 30 });

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/admin/form-options/genres/memoir");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-admin");
    expect(JSON.parse(String(options.body))).toMatchObject({ labelZhCn: "回忆录", labelEnUs: "Memoir", enabled: true });
  });


  it("saves file constraints with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ scope: "source", id: "cover-art" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await adminService.saveFileCategory({ scope: "source", id: "cover-art", labelZhCn: "封面图", labelEnUs: "Cover art", accept: ["image/jpeg"], maxBytes: 12000000, maxFiles: 2, allowsUrl: false, required: true, enabled: true, sortOrder: 10 });

    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/admin/file-categories/source/cover-art");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf-admin");
    expect(JSON.parse(String(options.body))).toMatchObject({ accept: ["image/jpeg"], maxBytes: 12000000, maxFiles: 2, required: true });
  });
  it("saves voice metadata with a concurrency token and excludes server-owned audio state", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ id: "warm-storyteller", updatedAt: "2026-08-25T00:00:01Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await adminService.saveVoiceReference({ id: "warm-storyteller", nameZhCn: "温暖叙述", nameEnUs: "Warm storyteller", descriptionZhCn: "中文", descriptionEnUs: "English", audioUrl: "/api/voices/warm-storyteller/sample", tagIds: ["warm"], recommended: true, enabled: true, sortOrder: 10, updatedAt: "2026-08-25T00:00:00Z" });

    const [, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const payload = JSON.parse(String(options.body));
    expect(payload.expectedUpdatedAt).toBe("2026-08-25T00:00:00Z");
    expect(payload.audioUrl).toBeUndefined();
    expect(payload.updatedAt).toBeUndefined();
  });
  it("uploads and removes real voice samples with CSRF protection", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) =>
      input.endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ token: "csrf-admin" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ id: "warm-storyteller", audioUrl: "/api/voices/warm-storyteller/sample" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([0x49, 0x44, 0x33])], "sample.mp3", { type: "audio/mpeg" });
    await adminService.uploadVoiceSample("warm-storyteller", file);
    let [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/admin/voices/warm-storyteller/sample");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("file")).toBe(file);
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBeTruthy();

    await adminService.removeVoiceSample("warm-storyteller");
    [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/admin/voices/warm-storyteller/sample");
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBeTruthy();
  });
});
