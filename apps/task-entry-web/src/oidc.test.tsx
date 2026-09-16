import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, oidcService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { OtherLoginMethods, OidcBinding, followOidc } from "@lifewood/ui/oidc";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(oidcService, "providers").mockResolvedValue({ items: [{ id: "first", nameZh: "企业账号", nameEn: "Company account" }] });
  vi.spyOn(oidcService, "binding").mockResolvedValue({ items: [{ id: "first", available: true, bound: false, nameZh: "企业账号", nameEn: "Company account" }] });
  vi.spyOn(oidcService, "start").mockRejectedValue(new ApiError({ code: "oidc.unavailable", messageKey: "oidc.errors.unavailable", retryable: false }));
  vi.spyOn(oidcService, "unbind").mockResolvedValue();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: string, portal: "customer" | "admin", profile = false, search = "") {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/login${search}`]}>{profile ? <OidcBinding userId="user" /> : <OtherLoginMethods portal={portal} />}</MemoryRouter></QueryClientProvider>)); await settle();
}
function button(text: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!; }
for (const locale of ["zh-CN", "en-US"]) for (const portal of ["customer", "admin"] as const) {
  it(`loads and selects other login methods only after expanding (${locale}, ${portal})`, async () => {
    await mount(locale, portal); expect(oidcService.providers).not.toHaveBeenCalled();
    await act(async () => button(i18n.t("oidc.other")).click()); await settle();
    const name = locale === "en-US" ? "Company account" : "企业账号"; expect(button(name)).toBeTruthy();
    await act(async () => button(name).click()); await settle();
    expect(oidcService.start).toHaveBeenCalledExactlyOnceWith(locale, portal, "first"); expect(host.textContent).toContain(i18n.t("oidc.errors.unavailable")); expect(button(name).disabled).toBe(false);
  });
  it(`does not invent providers when none are enabled (${locale}, ${portal})`, async () => {
    vi.mocked(oidcService.providers).mockResolvedValue({ items: [] }); await mount(locale, portal);
    await act(async () => button(i18n.t("oidc.other")).click()); await settle(); expect(host.textContent).toContain(i18n.t("oidc.none")); expect(oidcService.start).not.toHaveBeenCalled();
  });
  it(`renders safe localized callback errors (${locale}, ${portal})`, async () => {
    await mount(locale, portal, false, "?oidc=unbound"); expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("oidc.errors.unbound"));
  });
}
for (const locale of ["zh-CN", "en-US"]) {
  it(`requires current password before binding (${locale})`, async () => {
    await mount(locale, "customer", true); await act(async () => button(i18n.t("oidc.bind")).click());
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!; expect(input.required).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "current-password"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(oidcService.start).toHaveBeenCalledExactlyOnceWith(locale, "customer", "first", "current-password");
  });
}
it("rejects external or script destinations", () => { expect(() => followOidc("https://evil.example/")).toThrow(); expect(() => followOidc("javascript:alert(1)")).toThrow(); });
for (const locale of ["zh-CN", "en-US"]) {
  it(`selects the chosen provider instead of the first one (${locale})`, async () => {
    vi.mocked(oidcService.providers).mockResolvedValue({ items: [{ id: "first", nameZh: "服务甲", nameEn: "Provider A" }, { id: "second", nameZh: "服务乙", nameEn: "Provider B" }] });
    await mount(locale, "admin"); await act(async () => button(i18n.t("oidc.other")).click()); await settle();
    await act(async () => button(locale === "en-US" ? "Provider B" : "服务乙").click()); await settle();
    expect(oidcService.start).toHaveBeenCalledExactlyOnceWith(locale, "admin", "second");
  });
  it(`can unlink a disabled provider while retaining another (${locale})`, async () => {
    vi.mocked(oidcService.binding).mockResolvedValue({ items: [{ id: "first", nameZh: "服务甲", nameEn: "Provider A", available: true, bound: false }, { id: "second", nameZh: "服务乙", nameEn: "Provider B", available: false, bound: true }] });
    await mount(locale, "customer", true); await act(async () => button(i18n.t("oidc.unbind")).click());
    expect(host.querySelector("dialog")?.textContent).toContain(locale === "en-US" ? "Provider B" : "服务乙");
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "password"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(oidcService.unbind).toHaveBeenCalledExactlyOnceWith("password", "second");
  });
}
