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
});
