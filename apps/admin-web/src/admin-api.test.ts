import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";

describe("administrator API client", () => {
  beforeEach(() => vi.restoreAllMocks());

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
});
