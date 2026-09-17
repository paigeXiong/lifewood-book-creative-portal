import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { authService, emailService, type EmailSettings } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { ProfilePage } from "./pages/ProfilePage";

vi.mock("@lifewood/ui/login-sessions", () => ({ LoginSessions: () => <button data-sessions>Sessions</button> }));
vi.mock("@lifewood/ui/oidc", () => ({ OidcBinding: () => <div data-bindings /> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

for (const locale of ["zh-CN", "en-US"] as const) {
  it(`separates security from preferences while sharing email recovery and retaining contact edits (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    const user = { id: "customer", displayName: "Customer", email: "user@example.test", roles: ["customer"], permissions: [], locale, taskBackgroundMotion: true };
    vi.spyOn(authService, "getCurrentUser").mockResolvedValue(user);
    let settings: EmailSettings = { available: true, email: user.email, verified: false, notifications: false };
    const read = vi.spyOn(emailService, "settings").mockImplementation(async () => settings);
    let finish!: () => void;
    const verify = vi.spyOn(emailService, "verify").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const preferences = vi.spyOn(emailService, "preferences").mockRejectedValue(new Error("Response lost"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    client.setQueryData(["current-user"], user);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/profile`]}><Routes><Route path="/:locale/profile" element={<ProfilePage />} /></Routes></MemoryRouter></QueryClientProvider>)); await settle();
      const security = host.querySelector(".profile-security")!, personal = host.querySelector(".profile-preferences")!, account = host.querySelector(".profile-account")!;
      expect(security.textContent).toContain(i18n.t("profile.securityTitle"));
      expect(security.querySelector(".email-verification")).not.toBeNull(); expect(security.querySelector("[data-sessions]")).not.toBeNull(); expect(security.querySelector("[data-bindings]")).not.toBeNull();
      expect(account.querySelector(".profile-security-action")).toBeNull();
      expect(personal.querySelector(".email-notifications")).not.toBeNull(); expect(personal.querySelector(".email-verification")).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => host.querySelector<HTMLButtonElement>(".profile-edit-button")!.click());
      const input = host.querySelector<HTMLInputElement>("#profile-display-name")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unfinished name"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      const send = security.querySelector<HTMLButtonElement>(".email-verification button")!;
      await act(async () => { send.click(); send.click(); }); await settle();
      expect(verify).toHaveBeenCalledTimes(1); expect(send.disabled).toBe(true);
      expect(personal.querySelector<HTMLInputElement>('.email-notifications input')!.disabled).toBe(true);
      settings = { ...settings, verified: true };
      await act(async () => finish()); await settle();
      expect(read).toHaveBeenCalledTimes(2);
      expect(security.textContent).toContain(i18n.t("email.queued")); expect(personal.textContent).not.toContain(i18n.t("email.queued"));
      expect(host.querySelector("#profile-display-name")).toBe(input); expect(input.value).toBe("Unfinished name");
      const toggle = personal.querySelector<HTMLInputElement>('.email-notifications input')!;
      expect(toggle.disabled).toBe(false);
      settings = { ...settings, notifications: true };
      await act(async () => toggle.click()); await settle();
      expect(preferences).toHaveBeenCalledExactlyOnceWith(true); expect(toggle.checked).toBe(true);
      expect(personal.querySelector('[role="alert"]')).not.toBeNull(); expect(security.querySelector('[role="alert"]')).toBeNull();
      expect(input.value).toBe("Unfinished name");
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });
}
