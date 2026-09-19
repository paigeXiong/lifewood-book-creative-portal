import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, authService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { MyOrganizationPage as Directory } from "@lifewood/domain";
import { MyOrganizationPage } from "./pages/MyOrganizationPage";
import { clearUserProjectQueries } from "./projectQueryCache";

afterEach(() => vi.restoreAllMocks());
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const data: Directory = { organization: { name: "Sample Org", active: true, memberCount: 13 }, items: [{ id: "one", displayName: "Sample Member", roleLabel: "Customer member", active: true, isSelf: true, avatarUrl: "/api/me/organization/members/one/avatar" }], page: 1, pageSize: 12, total: 13, labels: { members: "Members", search: "Search names", empty: "No matching members", unassigned: "Unassigned", active: "Active", inactive: "Inactive", you: "You" } };

for (const locale of ["zh-CN", "en-US"]) it(`scopes directory by account, searches and paginates (${locale})`, async () => {
  await i18n.changeLanguage(locale);
  const get = vi.spyOn(authService, "getMyOrganization").mockImplementation(async args => ({ ...data, page: args.page ?? 1 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (id: string) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/organization`]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id, organization: { id: "org" } } }} />}><Route path="organization" element={<MyOrganizationPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>;
  try {
    await act(async () => root.render(render("a"))); await settle();
    expect(host.textContent).toContain("Sample Org"); expect(host.textContent).not.toContain("Customer member");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(data.items[0].avatarUrl);
    const next = [...host.querySelectorAll("button")].find(x => x.textContent === i18n.t("common.next"))!;
    await act(async () => next.click()); await settle(); expect(get.mock.calls.at(-1)![0].page).toBe(2);
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Sample"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(get.mock.calls.at(-1)![0]).toMatchObject({ search: "Sample", page: 1, locale });
    get.mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(render("b"))); await settle();
    expect(host.textContent).not.toContain("Sample Member");
    clearUserProjectQueries(client); expect(client.getQueryCache().findAll({ queryKey: ["my-organization"] })).toHaveLength(0);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});

it("hides cached members on denied refresh and recovers to an unassigned organization", async () => {
  const get = vi.spyOn(authService, "getMyOrganization").mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/en-US/organization"]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id: "a" } }} />}><Route path="organization" element={<MyOrganizationPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>)); await settle();
    get.mockRejectedValueOnce(new ApiError({ code: "auth.forbidden", messageKey: "errors.auth.forbidden", retryable: false }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["my-organization"] }); }); await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("Sample Member");
    get.mockResolvedValue({ ...data, organization: undefined, items: [], total: 0 });
    await act(async () => host.querySelector("button")!.click()); await settle();
    expect(host.textContent).toContain("Unassigned"); expect(host.querySelector("input")).toBeNull();
  } finally { await act(async () => root.unmount()); client.clear(); }
});
