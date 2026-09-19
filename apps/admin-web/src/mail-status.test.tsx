// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mailQueueService, type MailQueuePage } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { MailStatusPage } from "./MailStatusPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, router: ReturnType<typeof createMemoryRouter>;
const data: MailQueuePage = { available: false, checkedAt: 1800000000, counts: [{ status: "sent", count: 1 }, { status: "retrying", count: 2 }], kinds: ["verify", "reset"], total: 30, page: 1, pageSize: 25, items: [{ id: "id", recipient: "t***@example.test", kind: "verify", status: "sent", failures: 0, nextAttempt: null, expires: 1800000600 }] };
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
beforeEach(async () => {
  const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util");
  vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(mailQueueService, "list").mockResolvedValue(data);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(locale: "zh-CN" | "en-US", allowed = true) {
  await i18n.changeLanguage(locale);
  router = createMemoryRouter([{ path: "*", element: <MailStatusPage locale={locale} allowed={allowed} /> }], { initialEntries: [`/${locale}/settings/mail`] });
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle();
}
async function click(key: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t(key))!.click()); await settle(); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`keeps configuration diagnostics in localized help rather than inline (${locale})`, async () => {
    vi.mocked(mailQueueService.list).mockResolvedValue({ ...data, configurationChecks: [{ code: "port", passed: false }, { code: "credentials", passed: true }] });
    await mount(locale);
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("helpPopover.label", { label: i18n.t("mailQueue.configuration.title") })}"]`)!;
    expect(button).not.toBeNull(); expect(button.getAttribute("aria-expanded")).toBe("false");
    const popup = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(popup.getAttribute("popover")).toBe("auto"); expect(popup.textContent).toContain(i18n.t("mailQueue.configuration.hints.port"));
    expect(popup.textContent).not.toContain(i18n.t("mailQueue.configuration.hints.credentials"));
    expect(popup.textContent).toContain(i18n.t("mailQueue.configuration.passed")); expect(popup.textContent).toContain(i18n.t("mailQueue.configuration.scope"));
  });
  it(`does not request data without owner permission (${locale})`, async () => {
    await mount(locale, false); expect(mailQueueService.list).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("mailQueue.ownerOnly"));
  });
  it(`shows truthful sender and SMTP states and preserves filters in history (${locale})`, async () => {
    await mount(locale); expect(host.textContent).toContain(i18n.t("mailQueue.unavailable")); expect(host.querySelector("tbody")?.textContent).toContain(i18n.t("mailQueue.states.sent"));
    await click("mailQueue.nextPage"); expect(mailQueueService.list).toHaveBeenLastCalledWith("", "", 2, expect.anything());
    await act(async () => { const select = host.querySelector<HTMLSelectElement>("select")!; select.value = "retrying"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
    expect(mailQueueService.list).toHaveBeenLastCalledWith("retrying", "", 1, expect.anything()); expect(router.state.location.search).toBe("?status=retrying");
    await act(async () => { await router.navigate(-1); }); await settle(); expect(router.state.location.search).toBe("?page=2");
    expect(host.querySelector("tbody")?.textContent).toContain("t***@example.test");
  });
  it(`retains a stale snapshot on refresh failure and recovers (${locale})`, async () => {
    await mount(locale); vi.mocked(mailQueueService.list).mockRejectedValueOnce(new Error("offline")); await click("mailQueue.refresh");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("recovery.refreshFailed")); expect(host.querySelector("tbody")?.textContent).toContain("t***@example.test");
    vi.mocked(mailQueueService.list).mockResolvedValue({ ...data, total: 0, items: [] }); await click("mailQueue.refresh");
    expect(host.textContent).toContain(i18n.t("mailQueue.empty")); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
}

for(const locale of ["zh-CN","en-US"] as const) {
 it(`shows quota wait and clears it after refresh (${locale})`,async()=>{
  vi.mocked(mailQueueService.list).mockResolvedValue({...data,available:true,rate:{minuteUsed:10,dayUsed:20,perMinute:10,perDay:200,resumeAt:1800000000}});
  await mount(locale);
  expect(host.textContent).toContain(i18n.t("mailRate.usage",{minute:10,minuteLimit:10,day:20,dayLimit:200}));
  expect([...host.querySelectorAll('[role="status"]')].some(x=>x.textContent?.includes(new Date(1800000000000).toLocaleString(locale)))).toBe(true);
  vi.mocked(mailQueueService.list).mockResolvedValue({...data,available:true,rate:{minuteUsed:0,dayUsed:20,perMinute:10,perDay:200,resumeAt:null}});
  await click("mailQueue.refresh");
  expect([...host.querySelectorAll('[role="status"]')].some(x=>x.textContent?.includes(new Date(1800000000000).toLocaleString(locale)))).toBe(false);
 });
}

for (const locale of ["zh-CN", "en-US"] as const) {
  it(`searches recipients with existing filters and restores history (${locale})`, async () => {
    await mount(locale);
    await act(async () => { await router.navigate(`/${locale}/settings/mail?status=sent&kind=verify&page=2`); }); await settle();
    const input = host.querySelector<HTMLInputElement>('input[name="q"]')!;
    input.value = "  owner@example.test  ";
    await act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await settle();
    expect(mailQueueService.list).toHaveBeenLastCalledWith("sent", "verify", 1, expect.anything(), "owner@example.test");
    expect(router.state.location.search).not.toContain("page=");
    expect(host.querySelector("tbody")?.textContent).toContain("t***@example.test");
    await click("mailQueue.clear");
    expect(router.state.location.search).toBe("");
    await act(async () => { await router.navigate(-1); }); await settle();
    expect(host.querySelector<HTMLInputElement>('input[name="q"]')!.value).toBe("owner@example.test");
  });
}
