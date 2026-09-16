import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, authService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { ProfilePage } from "./pages/ProfilePage";

vi.mock("@lifewood/ui/login-sessions", () => ({ LoginSessions: () => null }));
vi.mock("@lifewood/ui/email", () => ({ EmailSettingsPanel: () => null }));
vi.mock("@lifewood/ui/oidc", () => ({ OidcBinding: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type User = Awaited<ReturnType<typeof authService.getCurrentUser>>;
const initial: User = { id: "account", displayName: "Original", phone: "123", email: "user@example.test", roles: ["customer"], permissions: [], locale: "zh-CN", taskBackgroundMotion: true };
let host: HTMLDivElement, root: Root, client: QueryClient, user: User;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.spyOn(authService, "getCurrentUser").mockImplementation(async () => user);
  vi.spyOn(authService, "updateProfile").mockImplementation(async input => ({ ...user, ...input }));
  vi.spyOn(authService, "updatePreferences").mockImplementation(async input => ({ ...user, ...input }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: "zh-CN" | "en-US") {
  user = { ...initial, locale }; client.setQueryData(["current-user"], user); await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/profile`]}><Routes><Route path="/:locale/profile" element={<ProfilePage />} /></Routes></MemoryRouter></QueryClientProvider>)); await settle();
}
async function edit() { await act(async () => host.querySelector<HTMLButtonElement>(".profile-edit-button")!.click()); }
async function name(value: string) {
  const field = host.querySelector<HTMLInputElement>("#profile-display-name")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`preserves the entire edit snapshot across a background update (${locale})`, async () => {
    await mount(locale); await edit(); await name("My draft");
    await act(async () => client.setQueryData(["current-user"], { ...user, displayName: "Remote", phone: "999" })); await settle();
    expect(host.querySelector<HTMLInputElement>("#profile-phone")!.value).toBe("123");
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("My draft");
    expect(document.body.dataset.unsavedChanges).toBe("true");
    await submit(); await settle(); expect(authService.updateProfile).toHaveBeenCalledExactlyOnceWith({ displayName: "My draft", phone: "123" });
  });
  it(`starts a fresh draft after saving and does not mark read-only updates dirty (${locale})`, async () => {
    await mount(locale); await edit(); await name("Saved"); await submit(); await settle();
    await act(async () => client.setQueryData(["current-user"], { ...user, displayName: "Latest", phone: "789" })); await settle();
    expect(document.body.dataset.unsavedChanges).toBe("false");
    await edit(); expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("Latest");
    expect(host.querySelector<HTMLInputElement>("#profile-phone")!.value).toBe("789");
  });
  it(`keeps a failed draft while reconciling a lost save response (${locale})`, async () => {
    const refresh = deferred<User>();
    vi.mocked(authService.updateProfile).mockRejectedValueOnce(new ApiError({ code: "network.unavailable", messageKey: "errors.network.unavailable", retryable: true }));
    await mount(locale); await edit(); await name("Saved remotely");
    vi.mocked(authService.getCurrentUser).mockReturnValueOnce(refresh.promise);
    await submit(); await settle();
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("Saved remotely");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => refresh.resolve({ ...user, displayName: "Saved remotely" })); await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("Saved remotely");
    expect(authService.updateProfile).toHaveBeenCalledTimes(1); expect(document.body.dataset.unsavedChanges).toBe("false");
  });
  it(`ignores old save results and clears edits on account replacement (${locale})`, async () => {
    const write = deferred<User>(); vi.mocked(authService.updateProfile).mockReturnValueOnce(write.promise);
    await mount(locale); await edit(); await name("Old draft"); await submit(); await submit();
    expect(authService.updateProfile).toHaveBeenCalledTimes(1);
    const replacement = { ...user, id: "replacement", displayName: "New account", phone: "888" };
    await act(async () => client.setQueryData(["current-user"], replacement)); await settle();
    expect(host.querySelector("#profile-display-name")).toBeNull();
    await act(async () => write.resolve({ ...user, displayName: "Old draft" })); await settle();
    expect(client.getQueryData(["current-user"])).toEqual(replacement);
    expect(host.textContent).not.toContain(i18n.t("profile.saved")); await edit();
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("New account");
  });
  it(`drops stale form state immediately on cross-tab account change (${locale})`, async () => {
    const write = deferred<User>(); vi.mocked(authService.updateProfile).mockReturnValueOnce(write.promise);
    await mount(locale); await edit(); await name("Old draft"); await submit();
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    expect(host.querySelector("form")).toBeNull(); expect(document.body.dataset.unsavedChanges).not.toBe("true");
    await act(async () => write.resolve({ ...user, displayName: "Old draft" })); await settle();
    expect(client.getQueryData(["current-user"])).toEqual(user);
    expect(host.textContent).toContain(i18n.t("accountSwitch.changed")); expect(authService.getCurrentUser).not.toHaveBeenCalled();
  });
  it(`continues lost-response reconciliation when another setting cancels its read (${locale})`, async () => {
    const refresh = deferred<User>(), replacement = deferred<User>();
    vi.mocked(authService.updateProfile).mockRejectedValueOnce(new ApiError({ code: "network.unavailable", messageKey: "errors.network.unavailable", retryable: true }));
    await mount(locale); await edit(); await name("Saved remotely");
    vi.mocked(authService.getCurrentUser).mockReturnValueOnce(refresh.promise).mockReturnValueOnce(replacement.promise);
    await submit(); await settle();
    await act(async () => host.querySelector<HTMLInputElement>("#profile-task-motion")!.click()); await settle();
    expect(authService.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await submit(); expect(authService.updateProfile).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve(user)); await settle();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => replacement.resolve({ ...user, displayName: "Saved remotely", taskBackgroundMotion: false })); await settle();
    expect(document.body.dataset.unsavedChanges).toBe("false");
    expect(client.getQueryData<User>(["current-user"])).toMatchObject({ displayName: "Saved remotely", taskBackgroundMotion: false });
    expect(authService.updateProfile).toHaveBeenCalledTimes(1);
  });
  it(`ignores a background read that returns after a confirmed save (${locale})`, async () => {
    const write = deferred<User>(), refresh = deferred<User>();
    vi.mocked(authService.updateProfile).mockReturnValueOnce(write.promise);
    await mount(locale); await edit(); await name("Confirmed name"); await submit();
    vi.mocked(authService.getCurrentUser).mockReturnValueOnce(refresh.promise);
    await act(async () => { void client.refetchQueries({ queryKey: ["current-user"] }); });
    // Another completed setting must survive cancellation of the older read too.
    await act(async () => client.setQueryData(["current-user"], { ...user, taskBackgroundMotion: false }));
    await act(async () => write.resolve({ ...user, displayName: "Confirmed name" })); await settle();
    await act(async () => refresh.resolve(user)); await settle();
    expect(client.getQueryData<User>(["current-user"])).toMatchObject({ displayName: "Confirmed name", taskBackgroundMotion: false });
    await edit();
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("Confirmed name");
  });
  it(`does not overwrite newer preferences with an older profile response (${locale})`, async () => {
    const write = deferred<User>(); vi.mocked(authService.updateProfile).mockReturnValueOnce(write.promise);
    await mount(locale); await edit(); await name("Updated name"); await submit();
    await act(async () => host.querySelector<HTMLInputElement>("#profile-task-motion")!.click()); await settle();
    expect(client.getQueryData<User>(["current-user"])?.taskBackgroundMotion).toBe(false);
    await act(async () => write.resolve({ ...user, displayName: "Updated name" })); await settle();
    expect(client.getQueryData<User>(["current-user"])).toMatchObject({ displayName: "Updated name", taskBackgroundMotion: false });
  });
}
