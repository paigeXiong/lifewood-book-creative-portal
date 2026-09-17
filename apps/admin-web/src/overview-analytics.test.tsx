// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { AdminAnalytics, SupportedLocale } from "@lifewood/domain";
import "./i18n";
import { OverviewAnalytics } from "./OverviewAnalytics";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const data: AdminAnalytics = { days: 30, timeZone: "UTC", generatedAt: "2026-09-17T00:00:00Z", trackingStartedAt: "2026-09-16T00:00:00Z", submitted: 4, completed: 2, durationSamples: 2, averageDays: 3.5, medianDays: 3.5, untrackedCompleted: 1, queues: [{ id: "waiting_customer", count: 3 }], aging: [{ id: "week", count: 3 }], trend: [{ date: "2026-09-16", submitted: 4, completed: 0 }, { date: "2026-09-17", submitted: 0, completed: 2 }] };
async function mount(locale: SupportedLocale) {
  await i18n.changeLanguage(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={client}><OverviewAnalytics locale={locale} /></QueryClientProvider></MemoryRouter>); await settle(); }); await act(settle);
  return { host, dispose: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`shows samples and supports period selection, keyboard trend and queue links (${locale})`, async () => {
    const api = vi.spyOn(adminService, "getOverviewAnalytics").mockResolvedValue(data);
    const f = await mount(locale);
    try {
      expect(f.host.textContent).toContain(i18n.t("adminAnalytics.samples", { count: 2 }));
      expect(f.host.querySelector("a")?.getAttribute("href")).toBe(`/${locale}/workbench?queue=waiting_customer`);
      const point = f.host.querySelector('g[role="button"]')!;
      await act(async () => { point.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      expect(point.getAttribute("aria-pressed")).toBe("true");
      expect(f.host.querySelector(".analytics-day")?.textContent).toContain("4");
      await act(async () => { const select = f.host.querySelector("select")!; select.value = "7"; select.dispatchEvent(new Event("change", { bubbles: true })); await settle(); }); await act(settle);
      expect(api).toHaveBeenLastCalledWith(7, expect.any(String), expect.anything());
    } finally { await f.dispose(); }
  });
}
it("keeps missing duration distinct from zero and recovers after fetch failure", async () => {
  const api = vi.spyOn(adminService, "getOverviewAnalytics").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ...data, durationSamples: 0, averageDays: null, medianDays: undefined });
  const f = await mount("zh-CN");
  try {
    expect(f.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(f.host.querySelector(".analytics-metrics")).toBeNull();
    await act(async () => { f.host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await new Promise(resolve => setTimeout(resolve, 700)); }); await act(settle);
    expect(api).toHaveBeenCalledTimes(2);
    expect([...f.host.querySelectorAll(".analytics-metrics strong")].slice(0, 2).map(el => el.textContent)).toEqual(["—", "—"]);
  } finally { await f.dispose(); }
});
