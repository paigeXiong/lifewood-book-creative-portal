import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, emailService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { EmailSettingsPanel, ForgotPasswordButton } from "@lifewood/ui/email";
import { EmailActionPage } from "./pages/EmailActionPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, hash: string, navigate: NavigateFunction, locationState: unknown;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
function Location() { const location = useLocation(); hash = location.hash; locationState = location.state; navigate = useNavigate(); return null; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(emailService, "settings").mockResolvedValue({ available: true, email: "test@example.test", verified: false, notifications: false });
  vi.spyOn(emailService, "availability").mockResolvedValue({ available: true });
  vi.spyOn(emailService, "verify").mockResolvedValue(); vi.spyOn(emailService, "preferences").mockResolvedValue({ available: true, email: "test@example.test", verified: true, notifications: true });
  vi.spyOn(emailService, "forgot").mockResolvedValue(); vi.spyOn(emailService, "consume").mockResolvedValue();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
async function mount(locale: string, screen: "profile" | "forgot" | "action", fragment = "") {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/email-action${fragment}`]}><Location /><Routes><Route path="/:locale/email-action" element={screen === "profile" ? <EmailSettingsPanel userId="user" /> : screen === "forgot" ? <ForgotPasswordButton /> : <EmailActionPage />} /></Routes></MemoryRouter></QueryClientProvider>)); await settle();
}
function button(key: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === i18n.t(key))!; }
async function input(node: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await settle(); }
for (const locale of ["zh-CN", "en-US"]) {
  it(`accepts native fragment navigation when browser entries share the default key (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    window.history.replaceState(null, "", `/${locale}/email-action#purpose=verify&token=${"A".repeat(64)}`);
    await act(async () => root.render(<BrowserRouter><Location /><Routes><Route path="/:locale/email-action" element={<EmailActionPage />} /></Routes></BrowserRouter>)); await settle();
    expect(window.location.hash).toBe("");
    await act(async () => { window.location.hash = `purpose=reset&token=${"B".repeat(64)}`; }); await settle();
    expect(window.location.hash).toBe("");
    const fields = host.querySelectorAll<HTMLInputElement>("input"); expect(fields.length).toBe(2);
    await input(fields[0], "new-password-123"); await input(fields[1], "new-password-123"); await submit();
    expect(emailService.consume).toHaveBeenCalledExactlyOnceWith("reset", "B".repeat(64), "new-password-123");
  });
  it(`requires verification before opting into notifications (${locale})`, async () => {
    await mount(locale, "profile"); const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(true);
    await act(async () => button("email.sendVerification").click()); await settle();
    expect(emailService.verify).toHaveBeenCalledTimes(1); expect(emailService.preferences).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("email.queued"));
  });
  it(`shows disabled mail configuration and allows opting out (${locale})`, async () => {
    vi.mocked(emailService.settings).mockResolvedValue({ available: false, email: "test@example.test", verified: true, notifications: true });
    await mount(locale, "profile"); expect(host.textContent).toContain(i18n.t("email.errors.unavailable"));
    await act(async () => host.querySelector<HTMLInputElement>('[role="switch"]')!.click()); await settle(); expect(emailService.preferences).toHaveBeenCalledExactlyOnceWith(false);
  });
  it(`refreshes verification when returning from the email tab (${locale})`, async () => {
    client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } });
    await mount(locale, "profile"); expect(host.querySelector<HTMLInputElement>('[role="switch"]')!.disabled).toBe(true);
    vi.mocked(emailService.settings).mockResolvedValue({ available: true, email: "test@example.test", verified: true, notifications: false });
    await act(async () => focusManager.setFocused(false)); await act(async () => focusManager.setFocused(true)); await settle();
    expect(host.querySelector<HTMLInputElement>('[role="switch"]')!.disabled).toBe(false);
    focusManager.setFocused(undefined);
  });
  it(`does not consume email links on page load or expose the fragment (${locale})`, async () => {
    const token = "A".repeat(64); await mount(locale, "action", `#purpose=verify&token=${token}`);
    expect(hash).toBe(""); expect(host.innerHTML).not.toContain(token); expect(emailService.consume).not.toHaveBeenCalled();
    await submit(); expect(emailService.consume).toHaveBeenCalledExactlyOnceWith("verify", token, undefined); expect(host.textContent).toContain(i18n.t("email.verifyDone"));
  });
  it(`checks repeated passwords before consuming a reset link (${locale})`, async () => {
    const token = "B".repeat(64); await mount(locale, "action", `#purpose=reset&token=${token}`);
    const fields = host.querySelectorAll<HTMLInputElement>("input"); await input(fields[0], "new-password-123"); await input(fields[1], "wrong-password-123");
    await submit(); expect(emailService.consume).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("auth.passwordMismatch"));
    await input(fields[1], "new-password-123"); await submit(); expect(emailService.consume).toHaveBeenCalledExactlyOnceWith("reset", token, "new-password-123"); expect(host.textContent).toContain(i18n.t("email.resetDone"));
  });
  it(`forgot password gives a generic result (${locale})`, async () => {
    await mount(locale, "forgot"); await act(async () => button("email.forgot").click()); await settle(); await input(host.querySelector("input")!, "test@example.test"); await submit();
    expect(emailService.forgot).toHaveBeenCalledExactlyOnceWith("test@example.test"); expect(host.textContent).toContain(i18n.t("email.forgotSent"));
  });
  it(`invalid links do not send requests (${locale})`, async () => {
    await mount(locale, "action", "#purpose=reset&token=bad"); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("email.errors.invalidLink")); expect(emailService.consume).not.toHaveBeenCalled();
  });
  it(`uses a newly opened email link instead of the previous token (${locale})`, async () => {
    const first = "A".repeat(64), second = "B".repeat(64);
    await mount(locale, "action", `#purpose=verify&token=${first}`); await submit();
    await act(async () => navigate(`/${locale}/email-action#purpose=reset&token=${second}`)); await settle();
    expect(hash).toBe(""); expect(JSON.stringify(locationState)).not.toContain(second); expect(host.innerHTML).not.toContain(second);
    expect(host.textContent).not.toContain(i18n.t("email.verifyDone"));
    const fields = host.querySelectorAll<HTMLInputElement>("input");
    await input(fields[0], "new-password-123"); await input(fields[1], "new-password-123"); await submit();
    expect(emailService.consume).toHaveBeenLastCalledWith("reset", second, "new-password-123");
  });
  for (const failed of [false, true]) it(`isolates a replacement link from late ${failed ? "failure" : "success"} (${locale})`, async () => {
    const pending = deferred<void>(); vi.mocked(emailService.consume).mockReturnValueOnce(pending.promise);
    await mount(locale, "action", `#purpose=reset&token=${"A".repeat(64)}`);
    const fields = host.querySelectorAll<HTMLInputElement>("input");
    await input(fields[0], "old-password-123"); await input(fields[1], "old-password-123"); await submit();
    await act(async () => navigate(`/${locale}/email-action#purpose=reset&token=${"B".repeat(64)}`)); await settle();
    expect([...host.querySelectorAll<HTMLInputElement>("input")].map(node => node.value)).toEqual(["", ""]);
    await act(async () => { if (failed) pending.reject(new Error("old request failed")); else pending.resolve(); });
    expect(host.querySelector("form")).not.toBeNull(); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(emailService.consume).toHaveBeenCalledTimes(1);
  });
  it(`rejects a replacement malformed link and a plain page visit (${locale})`, async () => {
    await mount(locale, "action", `#purpose=verify&token=${"A".repeat(64)}`);
    await act(async () => navigate(`/${locale}/email-action#purpose=verify&token=bad`)); await settle();
    expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("email.errors.invalidLink"));
    await act(async () => navigate(`/${locale}/email-action#purpose=verify&token=${"B".repeat(64)}`)); await settle();
    expect(host.querySelector("form")).not.toBeNull();
    await act(async () => navigate(`/${locale}/email-action`)); await settle();
    expect(host.querySelector("form")).toBeNull(); expect(emailService.consume).not.toHaveBeenCalled();
  });
  it(`prevents duplicate submissions and allows retry after a failed response (${locale})`, async () => {
    const pending = deferred<void>(), token = "C".repeat(64);
    vi.mocked(emailService.consume).mockReturnValueOnce(pending.promise);
    await mount(locale, "action", `#purpose=verify&token=${token}`);
    await submit(); await submit(); expect(emailService.consume).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new ApiError({ code: "network.unavailable", messageKey: "errors.network.unavailable", retryable: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("errors.network.unavailable"));
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await submit(); expect(emailService.consume).toHaveBeenCalledTimes(2);
    expect(emailService.consume).toHaveBeenLastCalledWith("verify", token, undefined);
    expect(host.textContent).toContain(i18n.t("email.verifyDone"));
  });
}
