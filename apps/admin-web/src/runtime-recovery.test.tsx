// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminService } from "@lifewood/api-client";
import type { RuntimeSettings } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { SystemRuntimePage } from "./SystemRuntimePage";
import { showAdminToast } from "./Toast";
const confirmation = vi.hoisted(() => vi.fn());
vi.mock("./useConfirm", () => ({ useConfirm: () => confirmation }));
vi.mock("./RuntimeHealthPanel", () => ({ RuntimeHealthPanel: () => null }));
vi.mock("./OutboundProxyPanel", () => ({ OutboundProxyPanel: () => null }));
vi.mock("./Toast", () => ({ showAdminToast: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, router: ReturnType<typeof createMemoryRouter>;
const data: RuntimeSettings = { scheme: "http", listenAddress: "127.0.0.1", port: 5077, activeScheme: "http", activeListenAddress: "127.0.0.1", activePort: 5077, restartRequired: false, canRestart: true, canShutdown: true, customer: { shared: false, scheme: "http", listenAddress: "127.0.0.1", port: 5173 }, admin: { shared: false, scheme: "http", listenAddress: "127.0.0.1", port: 5174 } };
data.activeCustomer = data.customer; data.activeAdmin = data.admin;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); confirmation.mockResolvedValue(true);
  vi.spyOn(adminService, "getRuntimeSettings").mockResolvedValue(data);
  vi.spyOn(adminService, "updateRuntimeSettings").mockResolvedValue({ ...data, port: 5078, restartRequired: true });
  vi.spyOn(adminService, "restartPlatform").mockResolvedValue({ action: "restart", requestedAt: "now" });
  vi.spyOn(adminService, "shutdownPlatform").mockResolvedValue({ action: "shutdown", requestedAt: "now" });
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); client.clear(); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale); router = createMemoryRouter([{ path: "*", element: <SystemRuntimePage locale={locale} userId="owner" /> }]);
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle();
}
async function click(text: string) { await act(async () => [...(host.querySelector('[role="dialog"]') ?? host).querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!.click()); await settle(); }
async function change(value: string) { await act(async () => { const field = host.querySelector<HTMLInputElement>("#runtime-port")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
const port = () => host.querySelector<HTMLInputElement>("#runtime-port")!.value;
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`keeps drafts during refresh and blocks overwriting observed server changes (${locale})`, async () => {
    await mount(locale); await change("5078");
    await act(async () => { client.setQueryData(["admin-runtime-settings", "owner"], { ...data, port: 5080 }); }); await settle();
    expect(port()).toBe("5078"); expect(host.textContent).toContain(i18n.t("runtimeRecovery.changed"));
    await click(i18n.t("admin.runtime.save")); expect(adminService.updateRuntimeSettings).not.toHaveBeenCalled();
    confirmation.mockResolvedValueOnce(false); await click(i18n.t("runtimeRecovery.reload")); expect(port()).toBe("5078");
    vi.mocked(adminService.getRuntimeSettings).mockResolvedValue({ ...data, port: 5080 });
    await click(i18n.t("runtimeRecovery.reload")); expect(port()).toBe("5080");
  });
  it(`locks all listener fields and submits only once (${locale})`, async () => {
    let resolve!: (value: RuntimeSettings) => void; vi.mocked(adminService.updateRuntimeSettings).mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(locale); await change("5078");
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle(); expect(adminService.updateRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#runtime-customer-port")!.matches(":disabled")).toBe(true);
    await change("5090"); expect(port()).toBe("5078");
    await act(async () => resolve({ ...data, port: 5078, restartRequired: true })); await settle();
    expect(port()).toBe("5078"); expect(showAdminToast).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#runtime-port")!.matches(":disabled")).toBe(false);
  });
  it(`keeps inputs after failed save and only reads on recovery (${locale})`, async () => {
    vi.mocked(adminService.updateRuntimeSettings).mockRejectedValue(new Error("offline"));
    await mount(locale); await change("5078"); await click(i18n.t("admin.runtime.save"));
    expect(port()).toBe("5078"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(adminService.getRuntimeSettings).mockResolvedValue({ ...data, port: 5078 });
    await click(i18n.t("runtimeRecovery.reload")); expect(port()).toBe("5078"); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(adminService.updateRuntimeSettings).toHaveBeenCalledTimes(1);
  });
  it(`ignores restart response after leaving the page (${locale})`, async () => {
    let resolve!: (value: { action: "restart"; requestedAt: string }) => void;
    vi.mocked(adminService.restartPlatform).mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(locale); await click(i18n.t("admin.runtime.restart")); await click(i18n.t("admin.runtime.confirmRestart"));
    expect(adminService.restartPlatform).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div>Other page</div>)); const timerSpy = vi.spyOn(globalThis, "setTimeout");
    await act(async () => resolve({ action: "restart", requestedAt: "now" }));
    expect(showAdminToast).not.toHaveBeenCalled(); expect(timerSpy.mock.calls.some(call => call[1] === 15_000)).toBe(false);
  });
  it(`retains a draft when explicit reload fails (${locale})`, async () => {
    await mount(locale); await change("5078"); vi.mocked(adminService.getRuntimeSettings).mockRejectedValue(new Error("offline"));
    await click(i18n.t("runtimeRecovery.reload")); expect(port()).toBe("5078"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(adminService.updateRuntimeSettings).not.toHaveBeenCalled();
  });
  it(`cancels scheduled restart navigation on unmount (${locale})`, async () => {
    await mount(locale); const schedule = vi.spyOn(globalThis, "setTimeout"), cancel = vi.spyOn(globalThis, "clearTimeout");
    await click(i18n.t("admin.runtime.restart")); await click(i18n.t("admin.runtime.confirmRestart"));
    const index = schedule.mock.calls.findIndex(call => call[1] === 15_000); expect(index).toBeGreaterThanOrEqual(0);
    const timer = schedule.mock.results[index].value; await act(async () => root.render(<div>Other page</div>)); expect(cancel).toHaveBeenCalledWith(timer);
  });
  it(`isolates a late save from the next account's draft (${locale})`, async () => {
    function Accounts() { const [userId, setUserId] = useState("owner"); return <><button onClick={() => setUserId("second")}>Switch account</button><SystemRuntimePage locale={locale} userId={userId} /></>; }
    await i18n.changeLanguage(locale); router = createMemoryRouter([{ path: "*", element: <Accounts /> }]);
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle();
    let resolve!: (value: RuntimeSettings) => void; vi.mocked(adminService.updateRuntimeSettings).mockReturnValue(new Promise(done => { resolve = done; }));
    await change("5078"); await click(i18n.t("admin.runtime.save")); await click("Switch account"); await change("5081");
    await act(async () => resolve({ ...data, port: 5078 })); await settle();
    expect(port()).toBe("5081"); expect(showAdminToast).not.toHaveBeenCalled();
  });
  it(`does not repeat a failed shutdown request (${locale})`, async () => {
    vi.mocked(adminService.shutdownPlatform).mockRejectedValue(new Error("offline"));
    await mount(locale); await click(i18n.t("admin.runtime.shutdown")); await click(i18n.t("admin.runtime.confirmShutdown"));
    await settle(); expect(adminService.shutdownPlatform).toHaveBeenCalledTimes(1);
    await click(i18n.t("common.cancel")); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it(`ignores a late shutdown response after unmount (${locale})`, async () => {
    let resolve!: (value: { action: "shutdown"; requestedAt: string }) => void;
    vi.mocked(adminService.shutdownPlatform).mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(locale); await click(i18n.t("admin.runtime.shutdown")); await click(i18n.t("admin.runtime.confirmShutdown"));
    expect(adminService.shutdownPlatform).toHaveBeenCalledTimes(1); await act(async () => root.render(<div>Other page</div>));
    await act(async () => resolve({ action: "shutdown", requestedAt: "now" })); expect(showAdminToast).not.toHaveBeenCalled();
  });
}
