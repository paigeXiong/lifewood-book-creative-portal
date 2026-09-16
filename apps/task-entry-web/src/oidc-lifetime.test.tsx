import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { oidcService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { OtherLoginMethods, OidcBinding } from "@lifewood/ui/oidc";

const { follow } = vi.hoisted(() => ({ follow: vi.fn() }));
vi.mock("../../../packages/ui/src/oidc-navigation", () => ({ followOidc: follow }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, navigate: NavigateFunction;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const destination = { url: `/api/auth/oidc/authorize?ticket=${"A".repeat(64)}` };
function Fixture({ portal }: { portal: "customer" | "admin" }) {
  navigate = useNavigate();
  return <Routes><Route path="/:locale/login" element={<OtherLoginMethods portal={portal} />} /><Route path="/:locale/profile" element={<OidcBinding userId="account" />} /><Route path="/:locale/elsewhere" element={<p>Elsewhere</p>} /></Routes>;
}
beforeEach(() => {
  follow.mockReset();
  vi.spyOn(oidcService, "providers").mockResolvedValue({ items: [{ id: "first", nameZh: "企业账号", nameEn: "Company account" }] });
  vi.spyOn(oidcService, "binding").mockResolvedValue({ items: [{ id: "first", available: true, bound: false, nameZh: "企业账号", nameEn: "Company account" }] });
  vi.spyOn(oidcService, "start").mockResolvedValue(destination);
  vi.spyOn(oidcService, "unbind").mockResolvedValue();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: string, portal: "customer" | "admin", profile = false) {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/${profile ? "profile" : "login"}`]}><Fixture portal={portal} /></MemoryRouter></QueryClientProvider>)); await settle();
}
function button(key: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === i18n.t(key))!; }
async function startLogin() {
  await act(async () => button("oidc.other").click()); await settle();
  await act(async () => host.querySelector<HTMLButtonElement>(".oidc-provider-options button")!.click());
}
async function submitBinding(bound = false) {
  await act(async () => button(bound ? "oidc.unbind" : "oidc.bind").click());
  const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "password"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
for (const locale of ["zh-CN", "en-US"]) for (const portal of ["customer", "admin"] as const) {
  it(`ignores late login after leaving and returning (${locale}, ${portal})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, portal); await startLogin();
    await act(async () => navigate(`/${locale}/elsewhere`)); await act(async () => navigate(-1)); await settle();
    await act(async () => pending.resolve(destination)); expect(follow).not.toHaveBeenCalled();
    await startLogin(); expect(follow).toHaveBeenCalledExactlyOnceWith(destination.url);
  });
  it(`invalidates login when only route search changes (${locale}, ${portal})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, portal); await startLogin();
    await act(async () => navigate(`/${locale}/login?oidc=failed`));
    await act(async () => pending.resolve(destination)); expect(follow).not.toHaveBeenCalled(); expect(button("oidc.other").disabled).toBe(false);
  });
  it(`rejects late login after account switch (${locale}, ${portal})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, portal); await startLogin();
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    await act(async () => pending.resolve(destination)); expect(follow).not.toHaveBeenCalled();
    expect(host.textContent).toContain(i18n.t("accountSwitch.changed")); expect(button("oidc.other").disabled).toBe(true);
  });
}
for (const locale of ["zh-CN", "en-US"]) {
  it(`allows current binding to navigate (${locale})`, async () => {
    await mount(locale, "customer", true); await submitBinding();
    expect(follow).toHaveBeenCalledExactlyOnceWith(destination.url);
  });
  it(`invalidates pending binding on profile route change (${locale})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, "customer", true); await submitBinding();
    await act(async () => navigate(`/${locale}/profile?oidc=failed`));
    await act(async () => pending.resolve(destination));
    expect(follow).not.toHaveBeenCalled(); expect(host.querySelector("dialog")).toBeNull();
  });
  it(`ignores a binding response after leaving profile (${locale})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, "customer", true); await submitBinding();
    await act(async () => navigate(`/${locale}/elsewhere`)); await act(async () => pending.resolve(destination));
    expect(follow).not.toHaveBeenCalled();
  });
  it(`clears password and ignores binding failure after account switch (${locale})`, async () => {
    const pending = deferred<typeof destination>(); vi.mocked(oidcService.start).mockReturnValueOnce(pending.promise);
    await mount(locale, "customer", true); await submitBinding();
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    await act(async () => pending.reject(new Error("stale failure")));
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("accountSwitch.changed"));
    await act(async () => button("common.cancel").click()); expect(host.querySelector("dialog")).toBeNull();
  });
  it(`does not refresh or close a replacement dialog after late unlink (${locale})`, async () => {
    vi.mocked(oidcService.binding).mockResolvedValue({ items: [{ id: "first", available: true, bound: true, nameZh: "企业账号", nameEn: "Company account" }] });
    const pending = deferred<void>(); vi.mocked(oidcService.unbind).mockReturnValueOnce(pending.promise);
    await mount(locale, "customer", true); await submitBinding(true);
    await act(async () => navigate(`/${locale}/elsewhere`)); await act(async () => navigate(-1)); await settle();
    await act(async () => button("oidc.unbind").click());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => pending.resolve()); expect(host.querySelector("dialog")).not.toBeNull(); expect(invalidate).not.toHaveBeenCalled();
  });
}
