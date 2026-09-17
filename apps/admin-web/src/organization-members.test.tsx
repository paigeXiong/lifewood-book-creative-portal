// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { AdminOrganization, AdminUser, SupportedLocale } from "@lifewood/domain";
import "./i18n";
import { OrganizationsPage } from "./OrganizationsPage";
import { UsersPage } from "./UsersPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = "2026-09-17T00:00:00Z";
const org: AdminOrganization = { id: "org-a", name: "Organization A", active: true, memberCount: 11, createdAt: date, updatedAt: date };
const user = (id: string, assigned = true): AdminUser => ({ id, displayName: `Member ${id}`, email: `${id}@example.test`, role: "customer", active: true, createdAt: date, updatedAt: date, ...(assigned ? { organization: { id: org.id, name: org.name } } : {}) });
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(async () => { const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util"); vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount(locale: SupportedLocale, path = "organizations") {
  await i18n.changeLanguage(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: `/${locale}/organizations`, element: <OrganizationsPage locale={locale} userId="owner" /> },
    { path: `/${locale}/users`, element: <UsersPage locale={locale} currentUserId="owner" /> },
  ], { initialEntries: [`/${locale}/${path}`] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); await settle(); });
  await act(settle);
  const button = (key: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === i18n.t(key) || el.getAttribute("aria-label") === i18n.t(key))!;
  const click = async (el: HTMLElement) => { await act(async () => { el.click(); await settle(); }); await act(settle); };
  return { host, client, router, button, click, dispose: async () => { await act(async () => root.unmount()); router.dispose(); client.clear(); host.remove(); } };
}

for (const locale of ["zh-CN", "en-US"] as const) {
  it(`expands, searches, pages and creates with organization prefilled (${locale})`, async () => {
    vi.spyOn(adminService, "listOrganizations").mockResolvedValue({ items: [org], total: 1, page: 1, pageSize: 20 });
    vi.spyOn(adminService, "listRoles").mockResolvedValue([{ id: "customer", label: "Customer" }]);
    let total = 11;
    const list = vi.spyOn(adminService, "listUsers").mockImplementation(async query => ({ items: query?.page === 2 && total <= 10 ? [] : [user("one")], total, page: query?.page ?? 1, pageSize: query?.pageSize ?? 10 }));
    const create = vi.spyOn(adminService, "createUser").mockResolvedValue(user("new"));
    const f = await mount(locale);
    try {
      expect(list).not.toHaveBeenCalled();
      await f.click(f.host.querySelector<HTMLButtonElement>(".organization-expand")!);
      expect(f.host.querySelector(".organization-expand")?.getAttribute("aria-expanded")).toBe("true");
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ organization: org.id, page: 1, pageSize: 10 }));
      await f.click(f.button("common.next", f.host.querySelector(".organization-members-panel")!));
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      total = 1;
      await act(async () => { await f.client.invalidateQueries({ queryKey: ["admin-users"] }); await settle(); }); await act(settle);
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
      expect(f.host.querySelector(".organization-member-list")?.textContent).toContain("Member one");
      const input = f.host.querySelector<HTMLInputElement>(".organization-members-search input")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Member"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); });
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Member", page: 1 }));
      await f.click(f.button("organizationMembers.create"));
      const form = f.host.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      expect(form.querySelector<HTMLSelectElement>('[name="organizationId"]')?.value).toBe(org.id);
      for (const [name, value] of Object.entries({ displayName: "New member", email: "new@example.test", password: "Test-only-123" })) form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); }); await act(settle);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org.id, role: "customer" }), expect.anything());
      expect(f.host.querySelector('[role="dialog"]')).toBeNull();
    } finally { await f.dispose(); }
  });

  it(`adds an unassigned user via a prefilled form and returns to expanded organization (${locale})`, async () => {
    vi.spyOn(adminService, "listOrganizations").mockResolvedValue({ items: [org], total: 1, page: 1, pageSize: 100 });
    vi.spyOn(adminService, "listRoles").mockResolvedValue([{ id: "customer", label: "Customer" }]);
    const list = vi.spyOn(adminService, "listUsers").mockResolvedValue({ items: [user("free", false), user("assigned")], total: 2, page: 1, pageSize: 20 });
    const update = vi.spyOn(adminService, "updateUser").mockResolvedValue(user("free"));
    const f = await mount(locale, `users?joinOrganization=${org.id}&organization=unassigned`);
    try {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ organization: "unassigned" }));
      expect(f.button("organizationMembers.assigned").disabled).toBe(true);
      await f.click(f.button("organizationMembers.addExisting"));
      expect(f.host.querySelector<HTMLSelectElement>('[name="organizationId"]')?.value).toBe(org.id);
      expect(update).not.toHaveBeenCalled();
      await f.click(f.button("common.save", f.host.querySelector('[role="dialog"]')!));
      expect(update).toHaveBeenCalledWith("free", expect.objectContaining({ organizationId: org.id, displayName: "Member free", role: "customer", active: true }));
      expect(f.router.state.location.pathname).toBe(`/${locale}/organizations`);
      expect(new URLSearchParams(f.router.state.location.search).get("members")).toBe(org.id);
      expect(f.host.querySelector(".organization-members-panel")).not.toBeNull();
    } finally { await f.dispose(); }
  });

  it(`disables member creation while organizations are loading and prefills once ready (${locale})`, async () => {
    let resolve!: (value: Awaited<ReturnType<typeof adminService.listOrganizations>>) => void;
    vi.spyOn(adminService, "listOrganizations").mockImplementation(() => new Promise(r => { resolve = r; }));
    vi.spyOn(adminService, "listUsers").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    vi.spyOn(adminService, "listRoles").mockResolvedValue([{ id: "customer", label: "Customer" }]);
    const f = await mount(locale, `users?organization=${org.id}`);
    try {
      expect(f.button("admin.users.create").disabled).toBe(true);
      await act(async () => { resolve({ items: [org], total: 1, page: 1, pageSize: 100 }); await settle(); }); await act(settle);
      await f.click(f.button("admin.users.create"));
      expect(f.host.querySelector<HTMLSelectElement>('[name="organizationId"]')?.value).toBe(org.id);
    } finally { await f.dispose(); }
  });

  it(`does not offer additions for inactive organizations (${locale})`, async () => {
    vi.spyOn(adminService, "listOrganizations").mockResolvedValue({ items: [{ ...org, active: false }], total: 1, page: 1, pageSize: 100 });
    vi.spyOn(adminService, "listUsers").mockResolvedValue({ items: [user("free", false)], total: 1, page: 1, pageSize: 20 });
    vi.spyOn(adminService, "listRoles").mockResolvedValue([{ id: "customer", label: "Customer" }]);
    const f = await mount(locale);
    try {
      await f.click(f.host.querySelector<HTMLButtonElement>(".organization-expand")!);
      expect(f.button("organizationMembers.create")).toBeUndefined();
      expect(f.host.querySelector('.organization-members-actions a')?.getAttribute("aria-label")).toBe(i18n.t("organizationMembers.manage"));
      await act(async () => { await f.router.navigate(`/${locale}/users?joinOrganization=${org.id}&organization=unassigned`); await settle(); }); await act(settle);
      expect(f.button("organizationMembers.addExisting").disabled).toBe(true);
      expect(f.host.textContent).toContain(i18n.t("organizationMembers.unavailable"));
    } finally { await f.dispose(); }
  });
}
