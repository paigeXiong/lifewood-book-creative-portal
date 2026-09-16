import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, authService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const close = vi.fn();
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
function deferred() { let resolve!: () => void, reject!: (reason: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.spyOn(authService, "changePassword").mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { mutations: { retry: 2 } } });
  client.setQueryData(["current-user"], { id: "account" });
  client.setQueryData(["private-data"], "keep");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); close.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/profile`]}><Routes><Route path="/:locale/profile" element={<ChangePasswordDialog userId="account" onClose={close} />} /><Route path="/:locale/login" element={<div data-login />} /></Routes></MemoryRouter></QueryClientProvider>));
  for (const [name, value] of Object.entries({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" })) host.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
}
function dispatchSubmit() { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`submits once, locks inputs and navigates after confirmed success (${locale})`, async () => {
    const write = deferred(); vi.mocked(authService.changePassword).mockReturnValue(write.promise);
    await mount(locale);
    await act(async () => { dispatchSubmit(); dispatchSubmit(); }); await settle();
    expect(authService.changePassword).toHaveBeenCalledExactlyOnceWith({ currentPassword: "old-password", newPassword: "new-password" });
    expect([...host.querySelectorAll("input")].every(input => input.disabled)).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(close).not.toHaveBeenCalled();
    await act(async () => write.resolve()); await settle();
    expect(host.querySelector("[data-login]")).not.toBeNull(); expect(client.getQueryData(["private-data"])).toBeUndefined();
  });
  it(`retains input and permits an explicit retry without automatic password writes (${locale})`, async () => {
    vi.mocked(authService.changePassword).mockRejectedValueOnce(new ApiError({ code: "network.unavailable", messageKey: "errors.network.unavailable", retryable: true }));
    await mount(locale); await act(async () => dispatchSubmit()); await settle();
    expect(authService.changePassword).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("errors.network.unavailable"));
    expect(host.querySelector<HTMLInputElement>('[name="newPassword"]')!.value).toBe("new-password");
    expect(host.querySelector<HTMLInputElement>('[name="newPassword"]')!.disabled).toBe(false);
    await act(async () => dispatchSubmit()); await settle();
    expect(authService.changePassword).toHaveBeenCalledTimes(2); expect(host.querySelector("[data-login]")).not.toBeNull();
  });
  it(`removes password fields on cross-tab account change and ignores a late result (${locale})`, async () => {
    const write = deferred(); vi.mocked(authService.changePassword).mockReturnValue(write.promise);
    await mount(locale); await act(async () => dispatchSubmit());
    await act(async () => { client.setQueryData(["current-user"], { id: "replacement" }); window.dispatchEvent(new Event("lw-account-changed")); });
    expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("accountSwitch.changed"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve()); await settle();
    expect(client.getQueryData(["private-data"])).toBe("keep"); expect(host.querySelector("[data-login]")).toBeNull();
  });
  it(`ignores completion after the dialog unmounts (${locale})`, async () => {
    const write = deferred(); vi.mocked(authService.changePassword).mockReturnValue(write.promise);
    await mount(locale); await act(async () => dispatchSubmit());
    await act(async () => root.render(<div data-other-page />));
    await act(async () => write.resolve()); await settle();
    expect(client.getQueryData(["private-data"])).toBe("keep"); expect(host.querySelector("[data-other-page]")).not.toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
  it(`rejects mismatched confirmation before requesting (${locale})`, async () => {
    await mount(locale); host.querySelector<HTMLInputElement>('[name="confirmPassword"]')!.value = "different";
    await act(async () => dispatchSubmit());
    expect(authService.changePassword).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("nav.passwordMismatch"));
    expect(document.activeElement).toBe(host.querySelector('[name="confirmPassword"]'));
  });
}
