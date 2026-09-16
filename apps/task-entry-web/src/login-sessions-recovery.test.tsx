import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loginDeviceService as service, type LoginDevice } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { LoginSessions } from "@lifewood/ui/login-sessions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const current: LoginDevice = { id: "current", browser: "chrome", platform: "windows", current: true, expiresAt: "2030-01-01T00:00:00Z" };
const other: LoginDevice = { ...current, id: "other", browser: "firefox", current: false };
const first = { items: [current, other], page: 1, total: 2 };
let host: HTMLDivElement, root: Root, client: QueryClient, remount: () => void, changeUser: (user: string) => void;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Fixture() {
  const [epoch, setEpoch] = useState(0), [user, setUser] = useState("account");
  remount = () => setEpoch(value => value + 1); changeUser = setUser;
  return <LoginSessions key={epoch} userId={user} />;
}
beforeEach(() => {
  vi.spyOn(service, "list").mockResolvedValue(first);
  vi.spyOn(service, "revoke").mockResolvedValue(); vi.spyOn(service, "revokeOthers").mockResolvedValue();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); onlineManager.setOnline(true); vi.restoreAllMocks(); });
function button(key: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === i18n.t(key))!; }
async function open() { await act(async () => button("productivity.devices").click()); await settle(); }
async function mount(locale: string) {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>)); await open();
}
async function select() { await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click()); }
function confirmation() { return host.querySelector<HTMLButtonElement>("section button"); }
for (const locale of ["zh-CN", "en-US"]) {
  it(`clears the previous device confirmation when paging (${locale})`, async () => {
    vi.mocked(service.list).mockImplementation(async page => page === 1 ? { ...first, total: 21 } : { items: [{ ...other, id: "page-two" }], page: 2, total: 21 });
    await mount(locale); await select(); expect(confirmation()).not.toBeNull();
    await act(async () => button("operations.next").click()); await settle(); expect(confirmation()).toBeNull();
    await select(); await act(async () => confirmation()!.click()); await settle();
    expect(service.revoke).toHaveBeenCalledExactlyOnceWith("page-two");
  });
  it(`discards confirmation when refreshing the list fails (${locale})`, async () => {
    await mount(locale); await select(); vi.mocked(service.list).mockRejectedValueOnce(new Error("offline"));
    await act(async () => client.invalidateQueries({ queryKey: ["login-devices", "account"] })); await settle();
    expect(confirmation()).toBeNull(); expect(button("productivity.revokeOthers").disabled).toBe(true);
    await act(async () => button("common.retry").click()); await settle(); expect(confirmation()).toBeNull();
    expect(service.revoke).not.toHaveBeenCalled(); expect(service.revokeOthers).not.toHaveBeenCalled();
  });
  it(`drops a target that vanished on refresh (${locale})`, async () => {
    await mount(locale); await select(); vi.mocked(service.list).mockResolvedValue({ items: [current], page: 1, total: 1 });
    await act(async () => client.invalidateQueries({ queryKey: ["login-devices", "account"] })); await settle();
    expect(confirmation()).toBeNull(); expect(service.revoke).not.toHaveBeenCalled();
  });
  it(`locks duplicate revocations through lost response recovery and remount (${locale})`, async () => {
    const write = deferred<void>(), refresh = deferred<typeof first>(); vi.mocked(service.revoke).mockReturnValueOnce(write.promise);
    await mount(locale); await select();
    await act(async () => { confirmation()!.click(); confirmation()!.click(); }); expect(service.revoke).toHaveBeenCalledExactlyOnceWith("other");
    await act(async () => remount()); await open(); expect(host.querySelector<HTMLButtonElement>("li button")!.disabled).toBe(true);
    vi.mocked(service.list).mockReturnValue(refresh.promise);
    await act(async () => write.reject(new Error("response lost"))); await settle(); expect(button("productivity.revokeOthers").disabled).toBe(true);
    await act(async () => refresh.resolve({ items: [current], page: 1, total: 1 })); await settle();
    expect(host.querySelector("li button")).toBeNull(); expect(confirmation()).toBeNull(); expect(button("common.close").disabled).toBe(false);
  });
  it(`keeps stale targets blocked during offline refresh (${locale})`, async () => {
    const write = deferred<void>(), refresh = deferred<typeof first>(); vi.mocked(service.revoke).mockReturnValueOnce(write.promise);
    await mount(locale); await select(); await act(async () => confirmation()!.click());
    await act(async () => onlineManager.setOnline(false)); vi.mocked(service.list).mockReturnValue(refresh.promise);
    await act(async () => write.reject(new Error("offline"))); await settle();
    expect(client.getQueryState(["login-devices", "account", 1])?.fetchStatus).toBe("paused");
    expect(confirmation()).toBeNull(); expect(button("productivity.revokeOthers").disabled).toBe(true);
    await act(async () => onlineManager.setOnline(true)); await settle(); expect(button("productivity.revokeOthers").disabled).toBe(true);
    await act(async () => refresh.resolve(first)); await settle(); expect(button("productivity.revokeOthers").disabled).toBe(false);
    expect(service.revoke).toHaveBeenCalledTimes(1);
  });
  it(`account changes invalidate confirmation and allow closing (${locale})`, async () => {
    const write = deferred<void>(); vi.mocked(service.revoke).mockReturnValueOnce(write.promise);
    await mount(locale); await select(); await act(async () => confirmation()!.click());
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    await act(async () => write.resolve()); await settle();
    expect(confirmation()).toBeNull(); expect(service.list).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(i18n.t("accountSwitch.changed"));
    await act(async () => button("common.close").click()); expect(host.querySelector("dialog")).toBeNull();
    await act(async () => changeUser("replacement")); await open(); expect(button("productivity.revokeOthers").disabled).toBe(false);
  });
  it(`requires explicit confirmation for all other devices and never offers the current device (${locale})`, async () => {
    await mount(locale); expect(host.querySelectorAll("li button").length).toBe(1);
    await act(async () => button("productivity.revokeOthers").click()); expect(service.revokeOthers).not.toHaveBeenCalled();
    vi.mocked(service.list).mockResolvedValue({ items: [current], page: 1, total: 1 });
    await act(async () => confirmation()!.click()); await settle();
    expect(service.revokeOthers).toHaveBeenCalledTimes(1); expect(service.revoke).not.toHaveBeenCalled(); expect(confirmation()).toBeNull();
  });
}
