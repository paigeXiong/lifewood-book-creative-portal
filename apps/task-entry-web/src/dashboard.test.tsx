import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, optionService, projectService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { CurrentUser, CustomerDashboard, FormOptions } from "@lifewood/domain";
import { DashboardPage, activityLevel, calendarDate } from "./pages/DashboardPage";
import { clearUserProjectQueries } from "./projectQueryCache";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); };
const project = { id: "mine", projectName: "<img src=x onerror=alert(1)>", bookTitle: "Book", status: "submitted", workflowStatus: "new", updatedAt: new Date().toISOString() };
function response(month: string, day: number): CustomerDashboard {
  const first = new Date(`${month}-01T12:00:00`);
  return { month, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, historyCompleteFrom: "2000-01-01T00:00:00Z", generatedAt: new Date().toISOString(), counts: { total: 1, actionRequired: 0, active: 1, downloadable: 0 }, statuses: [{ id: "new", count: 1 }], days: Array.from({ length: new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, submissions: index === day - 1 ? 1 : 0, resubmissions: 0, deliveries: 0, projects: index === day - 1 ? 1 : 0 })), activities: { page: 1, pageSize: 20, total: 1, items: [{ id: "one", kind: "submission", occurredAt: new Date().toISOString(), project }] }, recentProjects: [project] };
}
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`supports day selection, safe text, localized labels and clears previous daily detail during fetch (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    vi.spyOn(optionService, "getFormOptions").mockResolvedValue({ taskStatuses: [], workflowStatuses: [{ id: "new", label: "Localized status" }] } as unknown as FormOptions);
    const get = vi.spyOn(projectService, "getDashboard").mockImplementation(async params => response(params.month, params.day));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const render = (id: string) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/overview`]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id } as CurrentUser }} />}><Route path="overview" element={<DashboardPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>;
    try {
      await act(async () => root.render(render("account-a"))); await settle();
      expect(host.textContent).toContain(i18n.t("dashboard.calendar")); expect(host.textContent).toContain("Localized status"); expect(host.textContent).toContain(project.projectName); expect(host.querySelector("img")).toBeNull();
      const buttons = [...host.querySelectorAll<HTMLButtonElement>(".dashboard-day:not(:disabled)")];
      let resolve!: (value: CustomerDashboard) => void;
      get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      const target = buttons.find(button => button.getAttribute("aria-pressed") !== "true");
      if (target) {
        await act(async () => { target.focus(); target.click(); }); await settle();
        expect(document.activeElement).toBe(target); expect(host.querySelector(".dashboard-day-details a")).toBeNull();
        const params = get.mock.calls.at(-1)![0]; await act(async () => resolve(response(params.month, params.day))); await settle();
        expect(host.querySelector(".dashboard-day-details a")?.textContent).toBe(project.projectName); expect(target.getAttribute("aria-pressed")).toBe("true");
      }
      get.mockImplementation(() => new Promise(() => {}));
      await act(async () => root.render(render("account-b"))); await settle();
      expect(host.textContent).not.toContain(project.projectName);
      clearUserProjectQueries(client); expect(client.getQueryCache().findAll({ queryKey: ["customer-dashboard"] })).toHaveLength(0);
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });
  it(`keeps a refresh failure distinct from an empty report and hides data on denied access (${locale})`, async () => {
    await i18n.changeLanguage(locale); vi.spyOn(optionService, "getFormOptions").mockResolvedValue({ taskStatuses: [], workflowStatuses: [] } as unknown as FormOptions);
    const get = vi.spyOn(projectService, "getDashboard").mockImplementation(async params => response(params.month, params.day));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const host = document.createElement("div"); const root = createRoot(host);
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/overview`]}><Routes><Route path="/:locale" element={<Outlet context={{ user: { id: "account" } }} />}><Route path="overview" element={<DashboardPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>)); await settle();
      get.mockRejectedValue(new ApiError({ code: "network.unavailable", retryable: true })); await act(async () => client.refetchQueries({ queryKey: ["customer-dashboard"] })); await settle();
      expect(host.textContent).toContain(project.projectName); expect(host.textContent).toContain(i18n.t("recovery.refreshFailed"));
      get.mockRejectedValue(new ApiError({ code: "auth.forbidden", retryable: false })); await act(async () => client.refetchQueries({ queryKey: ["customer-dashboard"] })); await settle();
      expect(host.querySelector(".dashboard-calendar")).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });
}
it("uses fixed activity bins and local calendar dates", () => {
  expect([0, 1, 2, 3, 4, 7, 8, 100].map(activityLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  expect(calendarDate(new Date(2024, 1, 29, 23, 59))).toBe("2024-02-29");
});
