import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, authService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { MyOrganizationPage as Directory, OrganizationMemberProfile, OrganizationMemberActivity } from "@lifewood/domain";
import { MyOrganizationPage } from "./pages/MyOrganizationPage";
import { OrganizationMemberPage } from "./pages/OrganizationMemberPage";
import { clearUserProjectQueries } from "./projectQueryCache";

const activity: OrganizationMemberActivity = { calendar: { trackedFrom: "2026-09-17", days: [] }, presence: { status: "offline" }, presenceLabel: "Offline", counts: { submitted: 1, inProgress: 1, actionRequired: 0, completed: 0 }, projects: [{ id: "request", name: "Shared request", statusLabel: "In progress", status: "new", canOpen: false }], total: 1, page: 1, pageSize: 10, labels: { activity: "Sign-in activity", lastLogin: "Last sign-in", lastActive: "Last active", noRecord: "No record", submitted: "Submitted requests", inProgress: "In progress", actionRequired: "Needs response", completed: "Completed", requests: "Submitted requests", search: "Search requests", name: "Request", status: "Status", submittedAt: "First submitted", empty: "No requests", scope: "Submitted only", presenceHelp: "Estimated presence" } };
afterEach(() => vi.restoreAllMocks());
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const profile: OrganizationMemberProfile = { id: "other", displayName: "Other Member", organizationName: "Sample Org", roleLabel: "Customer member", avatarUrl: "/api/me/organization/members/other/avatar", labels: { name: "Name", organization: "Organization", role: "Role" } };
const directory: Directory = { organization: { name: "Sample Org", active: true, memberCount: 24 }, page: 2, pageSize: 12, total: 24, items: [{ ...profile, active: true, isSelf: false }, { ...profile, id: "self", displayName: "My Name", isSelf: true, active: true }], labels: { members: "Members", search: "Search names", empty: "No members", unassigned: "Unassigned", active: "Active", inactive: "Inactive", you: "You" } };

for (const locale of ["zh-CN", "en-US"]) it(`opens a read-only member profile and returns to the same directory search/page (${locale})`, async () => {
  await i18n.changeLanguage(locale);
  vi.spyOn(authService, "getMyOrganization").mockResolvedValue(directory);
  vi.spyOn(authService, "getOrganizationMember").mockResolvedValue(profile);
  vi.spyOn(authService, "getOrganizationMemberActivity").mockResolvedValue(activity);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/organization?search=Member&page=2`]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id: "self", organization: { id: "org" } } }} />}><Route path="organization" element={<MyOrganizationPage />} /><Route path="organization/members/:memberId" element={<OrganizationMemberPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>)); await settle();
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".my-org-member-link")];
    expect(links[0].getAttribute("href")).toBe(`/${locale}/organization/members/other?search=Member&page=2`);
    expect(links[1].getAttribute("href")).toBe(`/${locale}/profile`);
    await act(async () => links[0].click()); await settle();
    expect(authService.getOrganizationMember).toHaveBeenCalledWith(expect.objectContaining({ id: "other", locale }));
    expect(host.querySelector("h1")?.textContent).toBe("Other Member");
    expect(host.querySelectorAll("dt")).toHaveLength(5);
    expect(host.querySelector(".organization-member-profile")?.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Shared request");
    expect(host.querySelector(".member-requests-content a")).toBeNull();
    await act(async () => host.querySelector<HTMLAnchorElement>(".organization-member-back")!.click()); await settle();
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("Member");
    expect(authService.getMyOrganization).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Member", page: 2 }));
    expect(host.textContent).not.toContain("Active");
  } finally { await act(async () => root.unmount()); client.clear(); }
});

it("removes member data on denied refresh and does not share it across accounts", async () => {
  vi.spyOn(authService, "getOrganizationMember").mockResolvedValue(profile);
  vi.spyOn(authService, "getOrganizationMemberActivity").mockResolvedValue(activity);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); const root = createRoot(host);
  const render = (id: string) => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/en-US/organization/members/other"]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id } }} />}><Route path="organization/members/:memberId" element={<OrganizationMemberPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>;
  try {
    await act(async () => root.render(render("first"))); await settle();
    vi.mocked(authService.getOrganizationMember).mockRejectedValue(new ApiError({ code: "organization.member_unavailable", messageKey: "organizationMember.unavailable", retryable: false }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["organization-member"] }); }); await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("Other Member");
    expect(host.querySelector(".organization-member-back")).not.toBeNull();
    vi.mocked(authService.getOrganizationMember).mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(render("second"))); await settle();
    expect(host.textContent).not.toContain("Other Member"); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    clearUserProjectQueries(client); expect(client.getQueryCache().findAll({ queryKey: ["organization-member"] })).toHaveLength(0);
  } finally { await act(async () => root.unmount()); client.clear(); }
});

it("paginates and searches submitted requests, then hides data when activity access is revoked", async () => {
  await i18n.changeLanguage("en-US");
  vi.spyOn(authService, "getOrganizationMember").mockResolvedValue(profile);
  const load = vi.spyOn(authService, "getOrganizationMemberActivity").mockImplementation(async ({ page = 1, search = "" }) => ({ ...activity, page, total: search ? 0 : 11, projects: search ? [] : activity.projects }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/en-US/organization/members/other"]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id: "self", organization: { id: "org" } } }} />}><Route path="organization/members/:memberId" element={<OrganizationMemberPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>)); await settle();
    await act(async () => host.querySelector<HTMLButtonElement>(".my-org-pager button:last-child")!.click()); await settle();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, search: "" }));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Missing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: "Missing" }));
    expect(host.textContent).toContain("No requests");
    expect(host.querySelector(".member-metrics")?.textContent).toContain("Submitted requests1");
    load.mockRejectedValue(new ApiError({ code: "organization.member_unavailable", messageKey: "organizationMember.unavailable", retryable: false }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["organization-member-activity"] }); }); await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Other Member");
    expect(host.querySelector(".member-dashboard")).toBeNull();
  } finally { await act(async () => root.unmount()); client.clear(); }
});
