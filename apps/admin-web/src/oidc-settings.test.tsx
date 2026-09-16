// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, oidcService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { OidcSettingsPage } from "./OidcSettingsPage";
import "./i18n";

const confirmation = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<boolean>>());
vi.mock("./useConfirm", () => ({ useConfirm: () => confirmation }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const configuration = { id: "default", version: 2, nameZh: "企业账号", nameEn: "Company account", issuer: "https://idp.example.test", clientId: "client", publicOrigin: "https://portal.example.test", adminOrigin: "https://portal.example.test/admin", enabled: false, hasSecret: true };
let host: HTMLDivElement, root: Root, client: QueryClient, router: ReturnType<typeof createMemoryRouter>;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(async () => {
  const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util");
  vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } });
  confirmation.mockReset().mockResolvedValue(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(oidcService, "configuration").mockResolvedValue({ items: [configuration] });
  vi.spyOn(oidcService, "remove").mockResolvedValue();
  vi.spyOn(oidcService, "test").mockResolvedValue();
  vi.spyOn(oidcService, "save").mockResolvedValue({ ...configuration, version: 3 });
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(locale: "zh-CN" | "en-US", allowed = true) {
  await i18n.changeLanguage(locale);
  router = createMemoryRouter([{ path: "/:locale/settings/oidc", element: <OidcSettingsPage locale={locale} allowed={allowed} /> }, { path: "/elsewhere", element: <p>Elsewhere</p> }], { initialEntries: [`/${locale}/settings/oidc`] });
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)); await settle();
}
async function inputField(key: string, value: string) {
  const input = key === "secret" ? host.querySelector<HTMLInputElement>('input[type="password"]')! : host.querySelector<HTMLInputElement>(`input[id$="-${key}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function unloadPrevented() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
async function click(key: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === i18n.t(key))!.click()); await settle(); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`protects dirty inputs on cancel, refresh and route changes (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); expect(unloadPrevented()).toBe(false);
    await inputField("secret", "unsaved-test-secret"); expect(unloadPrevented()).toBe(true);
    await click("common.cancel"); expect(confirmation).toHaveBeenCalledWith(i18n.t("common.unsavedConfirm"), false);
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("unsaved-test-secret");
    await act(async () => { await router.navigate("/elsewhere"); }); await settle();
    expect(router.state.location.pathname).toBe(`/${locale}/settings/oidc`);
    await act(async () => { await router.navigate(`/${locale === "zh-CN" ? "en-US" : "zh-CN"}/settings/oidc`); });
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("unsaved-test-secret");
    confirmation.mockResolvedValue(true); await click("common.cancel"); expect(host.querySelector("form")).toBeNull(); expect(unloadPrevented()).toBe(false);
  });
  it(`blocks navigation while saving and clears protection after success (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); await inputField("nameZh", "Changed");
    let finish!: (value: typeof configuration) => void;
    vi.mocked(oidcService.save).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click("oidc.save"); await act(async () => { await router.navigate("/elsewhere"); }); await settle();
    expect(router.state.location.pathname).toBe(`/${locale}/settings/oidc`); expect(confirmation).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
    await act(async () => finish({ ...configuration, version: 3 })); await settle();
    expect(host.querySelector("form")).toBeNull(); expect(unloadPrevented()).toBe(false);
  });
  it(`reviews a conflict without saving and keeps only locally changed fields (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); await inputField("nameZh", "Local label"); await inputField("secret", "unsaved-test-secret");
    vi.mocked(oidcService.save).mockRejectedValueOnce(new ApiError({ code: "oidc.conflict", messageKey: "oidc.errors.conflict", retryable: false }));
    await click("oidc.save"); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    vi.mocked(oidcService.configuration).mockResolvedValue({ items: [{ ...configuration, version: 8, nameZh: "Server label", nameEn: "New English label", enabled: true }] });
    await click("oidc.recovery.review"); expect(host.querySelector("table")!.textContent).toContain("Server label"); expect(host.querySelector("table")!.textContent).not.toContain("unsaved-test-secret");
    await click("oidc.recovery.keep"); expect(host.querySelector(".oidc-conflict")).not.toBeNull();
    confirmation.mockResolvedValue(true); await click("oidc.recovery.keep");
    expect(oidcService.save).toHaveBeenCalledTimes(1); expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(""); expect(unloadPrevented()).toBe(true);
    await click("oidc.save"); expect(oidcService.save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 8, nameZh: "Local label", nameEn: "New English label", enabled: true, secret: undefined }));
  });
  it(`adopts the server version only after confirmation and handles another conflict (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); await inputField("nameZh", "Local label");
    vi.mocked(oidcService.save).mockRejectedValue(new ApiError({ code: "oidc.conflict", messageKey: "oidc.errors.conflict", retryable: false })); await click("oidc.save");
    vi.mocked(oidcService.configuration).mockResolvedValue({ items: [{ ...configuration, version: 5, nameZh: "Latest" }] }); await click("oidc.recovery.review");
    await click("oidc.recovery.replace"); expect(host.querySelector<HTMLInputElement>('input[id$="-nameZh"]')!.value).toBe("Local label");
    confirmation.mockResolvedValue(true); await click("oidc.recovery.replace"); expect(unloadPrevented()).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[id$="-nameZh"]')!.value).toBe("Latest");
    await inputField("nameZh", "Another edit"); await click("oidc.save"); expect(oidcService.save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5 }));
    expect(host.querySelector(".oidc-conflict")).not.toBeNull(); expect(host.querySelector("table")).toBeNull(); expect(host.querySelector<HTMLInputElement>('input[id$="-nameZh"]')!.value).toBe("Another edit");
  });
  it(`preserves input when latest configuration fails to load or was deleted (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); await inputField("nameZh", "Local label");
    vi.mocked(oidcService.save).mockRejectedValue(new ApiError({ code: "oidc.conflict", messageKey: "oidc.errors.conflict", retryable: false })); await click("oidc.save");
    vi.mocked(oidcService.configuration).mockRejectedValue(new Error("offline")); await click("oidc.recovery.review");
    expect(host.querySelector<HTMLInputElement>('input[id$="-nameZh"]')!.value).toBe("Local label");
    vi.mocked(oidcService.configuration).mockResolvedValue({ items: [] }); await click("oidc.recovery.review");
    expect(host.textContent).toContain(i18n.t("oidc.recovery.missing")); expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true); expect(oidcService.save).toHaveBeenCalledTimes(1);
  });
  it(`keeps the editor mounted when a background list refresh fails (${locale})`, async () => {
    await mount(locale); await click("oidc.configure"); await inputField("nameZh", "Local label");
    vi.mocked(oidcService.configuration).mockRejectedValue(new Error("offline"));
    await act(async () => { await client.refetchQueries({ queryKey: ["admin-oidc"] }); }); await settle();
    expect(host.querySelector<HTMLInputElement>('input[id$="-nameZh"]')!.value).toBe("Local label"); expect(unloadPrevented()).toBe(true);
  });
  it(`blocks non-owner configuration access (${locale})`, async () => {
    await mount(locale, false); expect(oidcService.configuration).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("oidc.ownerOnly")); expect(host.querySelector("input")).toBeNull();
  });
  it(`connects localized field guidance to the shared popover (${locale})`, async () => {
    await mount(locale); await click("oidc.configure");
    const help = host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("helpPopover.label", { label: i18n.t("oidc.fields.publicOrigin") })}"]`)!;
    expect(help.getAttribute("type")).toBe("button");
    expect(help.getAttribute("aria-expanded")).toBe("false");
    const popup = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(popup.getAttribute("popover")).toBe("auto");
    expect(popup.textContent).toContain(i18n.t("oidc.publicOriginHint"));
    expect(oidcService.save).not.toHaveBeenCalled();
  });
  it(`tests metadata separately and preserves the stored secret (${locale})`, async () => {
    await mount(locale); await click("oidc.configure");
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect([...host.querySelectorAll("code")].map(node => node.textContent)).toEqual(["https://portal.example.test/api/auth/oidc/callback", "https://portal.example.test/api/auth/oidc/callback"]);
    await click("oidc.test"); expect(oidcService.test).toHaveBeenCalledOnce(); expect(oidcService.save).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("oidc.tested"));
    await click("oidc.save"); expect(oidcService.save).toHaveBeenCalledWith(expect.objectContaining({ version: 2, secret: undefined })); expect(host.querySelector("form")).toBeNull();
  });
  it(`keeps edits visible on stale configuration conflict (${locale})`, async () => {
    vi.mocked(oidcService.save).mockRejectedValue(new ApiError({ code: "oidc.conflict", messageKey: "oidc.errors.conflict", retryable: false }));
    await mount(locale); await click("oidc.configure"); await click("oidc.save"); expect(host.textContent).toContain(i18n.t("oidc.errors.conflict")); expect(host.querySelector("form")).not.toBeNull();
  });
  it(`shows independent provider rows and versioned delete confirmation (${locale})`, async () => {
    vi.mocked(oidcService.configuration).mockResolvedValue({ items: [configuration, { ...configuration, id: "second", nameZh: "第二服务", nameEn: "Second provider", enabled: true, version: 7 }] });
    await mount(locale); const rows = host.querySelectorAll(".oidc-provider-row"); expect(rows.length).toBe(2);
    await act(async () => [...rows[1].querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === i18n.t("oidc.delete"))!.click());
    expect(oidcService.remove).not.toHaveBeenCalled(); await click("oidc.confirmDelete");
    expect(oidcService.remove).toHaveBeenCalledExactlyOnceWith("second", 7);
  });
  it(`starts new providers disabled and shows provider-specific callback after saving (${locale})`, async () => {
    await mount(locale); await click("oidc.add"); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    expect(host.textContent).toContain(i18n.t("oidc.callbackPending"));
    vi.mocked(oidcService.save).mockResolvedValue({ ...configuration, id: "new-provider", version: 1 });
    const values = [configuration.nameZh, configuration.nameEn, configuration.issuer, configuration.clientId, configuration.publicOrigin, configuration.adminOrigin];
    await act(async () => [...host.querySelectorAll<HTMLInputElement>('input[required]')].forEach((input, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, values[index]); input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    await click("oidc.save");
    expect(oidcService.save).toHaveBeenCalledWith(expect.objectContaining({ id: "", enabled: false, version: 0 }));
    expect(host.querySelector("code")?.textContent).toBe("https://portal.example.test/api/auth/oidc/callback/new-provider");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
  });
}
