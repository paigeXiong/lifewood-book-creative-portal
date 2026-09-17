// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, outboundProxyService, type ProxySettings } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { OutboundProxyPanel } from "./OutboundProxyPanel";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, router: ReturnType<typeof createMemoryRouter>;
const data: ProxySettings = { revision: "r1", scopes: [
  { id: "global", label: "Global", mode: "system", effectiveMode: "system", address: "", username: "", hasPassword: false },
  { id: "oidc:one", label: "OIDC One", mode: "custom", effectiveMode: "custom", address: "http://localhost:7890", username: "user", hasPassword: true },
], modes: [{ id: "inherit", label: "Inherit" }, { id: "direct", label: "Direct" }, { id: "system", label: "System" }, { id: "custom", label: "Custom" }], labels: { mode: "Mode", address: "URL", username: "User", password: "Password", savedPassword: "Saved", clearPassword: "Clear", help: "SMTP remains direct", passwordHelp: "Encrypted", testHelp: "No model calls", effective: "Effective" } };
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.spyOn(outboundProxyService, "get").mockResolvedValue(data); vi.spyOn(outboundProxyService, "save").mockResolvedValue({ ...data, revision: "r2" }); vi.spyOn(outboundProxyService, "test").mockResolvedValue({ status: 401 }); });
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: "zh-CN" | "en-US", scope = "OIDC One") { await i18n.changeLanguage(locale); router = createMemoryRouter([{ path: "*", element: <OutboundProxyPanel locale={locale} /> }]); await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle(); await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("outboundProxy.configure")} · ${scope}"]`)!.click()); await settle(); }
async function click(text: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!.click()); await settle(); }
async function change(selector: string, value: string) { await act(async () => { const field = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`hides secrets and help; checks only the saved scope (${locale})`, async () => { await mount(locale); expect(host.querySelector<HTMLInputElement>("#proxy-password")!.value).toBe(""); expect(host.querySelectorAll('[popover="auto"]').length).toBeGreaterThanOrEqual(3); expect(outboundProxyService.test).not.toHaveBeenCalled(); await click(i18n.t("outboundProxy.test")); expect(outboundProxyService.test).toHaveBeenCalledExactlyOnceWith("r1", "oidc:one"); expect(host.querySelector('[role="status"]')?.textContent).toContain("401"); });
  it(`disables testing unsaved changes and preserves drafts after conflicts (${locale})`, async () => { await mount(locale); await change('input[type="url"]', "http://elsewhere:7890"); expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === i18n.t("outboundProxy.test"))!.disabled).toBe(true); vi.mocked(outboundProxyService.save).mockRejectedValue(new ApiError({ code: "proxy.conflict", messageKey: "outboundProxy.errors.conflict", fallbackMessage: "hidden-sensitive-diagnostic", retryable: false })); await click(i18n.t("common.save")); expect(host.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe("http://elsewhere:7890"); expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("outboundProxy.errors.conflict")); expect(host.textContent).not.toContain("hidden-sensitive-diagnostic"); });
  it(`clears both credential fields explicitly (${locale})`, async () => { await mount(locale); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click(i18n.t("common.save")); expect(outboundProxyService.save).toHaveBeenCalledWith(expect.objectContaining({ scope: "oidc:one", revision: "r1", username: "", password: "", clearPassword: true }), locale); });
  it(`global mode cannot inherit (${locale})`, async () => { await mount(locale, "Global"); expect([...host.querySelectorAll("option")].map(o => o.value)).not.toContain("inherit"); expect(outboundProxyService.test).not.toHaveBeenCalled(); });
}
it("updates translated scope heading while preserving an unsaved credential", async () => {
  function Harness() { const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN"); return <><button onClick={() => setLocale("en-US")}>Switch</button><OutboundProxyPanel locale={locale} /></>; }
  await i18n.changeLanguage("zh-CN"); router = createMemoryRouter([{ path: "*", element: <Harness /> }]);
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle();
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("outboundProxy.configure")} · OIDC One"]`)!.click()); await settle();
  await change("#proxy-password", "draft-credential");
  vi.mocked(outboundProxyService.get).mockResolvedValue({ ...data, scopes: data.scopes.map(s => ({ ...s, label: "Translated " + s.label })) });
  await click("Switch"); await settle();
  expect(host.querySelector("#proxy-editor-title")!.textContent).toContain("Translated OIDC One");
  expect(host.querySelector<HTMLInputElement>("#proxy-password")!.value).toBe("draft-credential");
});
