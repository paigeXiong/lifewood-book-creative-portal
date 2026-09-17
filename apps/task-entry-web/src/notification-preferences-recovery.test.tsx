import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { NotificationCenter } from "@lifewood/ui/notifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const service = api.notificationService;
const initial: api.NotificationPreferences = { toast: true, sound: false, quietStart: null, quietEnd: null, timeZone: "UTC", mutedKinds: [] };
let host: HTMLDivElement, root: Root, client: QueryClient, account: string, remount: () => void;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Fixture({ admin }: { admin: boolean }) { const [epoch, setEpoch] = useState(0); remount = () => setEpoch(value => value + 1); return <NotificationCenter key={epoch} admin={admin} />; }
beforeEach(() => {
  account = "account";
  vi.spyOn(api, "captureAccountGuard").mockImplementation(() => { const captured = account; return () => { if (captured !== account) throw new Error("account changed"); }; });
  vi.spyOn(service, "catalog").mockResolvedValue({ retentionDays: 365, items: [] });
  vi.spyOn(service, "list").mockResolvedValue({ items: [], nextCursor: null, unread: 0, watermark: 0 });
  vi.spyOn(service, "preferences").mockResolvedValue(initial);
  vi.spyOn(service, "savePreferences").mockResolvedValue(initial);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); onlineManager.setOnline(true); host?.remove(); vi.restoreAllMocks(); });
function button(key: string, scope: ParentNode = host) { return scope.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`)!; }
function dialog() { return host.querySelector<HTMLDialogElement>("dialog")!; }
function toast() { return dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!; }
async function open() { await act(async () => button("notifications.preferences").click()); await settle(); }
async function mount(locale: string, admin: boolean) {
  await i18n.changeLanguage(locale);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData([admin ? "admin-me" : "current-user"], { id: account });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications`]}><Routes><Route path="/:locale/notifications" element={<Fixture admin={admin} />} /></Routes></MemoryRouter></QueryClientProvider>));
  await settle(); await open();
}
async function submit() { await act(async () => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle(); }

for (const locale of ["zh-CN", "en-US"]) for (const admin of [false, true]) {
  it(`does not queue an offline save or trap the dialog until reconnection (${locale}, ${admin})`, async () => {
    await mount(locale, admin); await act(async () => toast().click());
    vi.mocked(service.savePreferences).mockRejectedValue(new Error("offline"));
    await act(async () => onlineManager.setOnline(false)); await submit();
    expect(service.savePreferences).toHaveBeenCalledTimes(1); expect(toast().checked).toBe(false);
    expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    expect(button("common.close", dialog()).disabled).toBe(false);
    await act(async () => button("common.close", dialog()).click()); expect(dialog()).toBeNull();
    await act(async () => onlineManager.setOnline(true)); await settle();
    expect(service.savePreferences).toHaveBeenCalledTimes(1);
  });
  it(`does not let a stale background read replace the acknowledged save (${locale}, ${admin})`, async () => {
    const write = deferred<api.NotificationPreferences>(), read = deferred<api.NotificationPreferences>();
    vi.mocked(service.savePreferences).mockReturnValue(write.promise);
    await mount(locale, admin); await act(async () => toast().click()); await submit();
    vi.mocked(service.preferences).mockReturnValue(read.promise);
    await act(async () => { void client.refetchQueries({ queryKey: ["notification-preferences", account], exact: true }); });
    await act(async () => write.resolve({ ...initial, toast: false })); await settle();
    expect(dialog()).toBeNull();
    await act(async () => read.resolve(initial)); await settle(); await open();
    expect(toast().checked).toBe(false);
    expect(client.getQueryData(["notification-preferences", account])).toEqual({ ...initial, toast: false });
  });
  it(`locks fields, duplicate submits and nested Escape while saving (${locale}, ${admin})`, async () => {
    const write = deferred<api.NotificationPreferences>(); vi.mocked(service.savePreferences).mockReturnValue(write.promise);
    await mount(locale, admin); await act(async () => toast().click());
    const form = dialog().querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await settle();
    expect(service.savePreferences).toHaveBeenCalledTimes(1);
    expect(vi.mocked(service.savePreferences).mock.calls[0][0].toast).toBe(false);
    expect([...dialog().querySelectorAll("input")].every(input => input.disabled)).toBe(true);
    expect(button("common.close", dialog()).disabled).toBe(true);
    const parentCancel = vi.fn(); host.addEventListener("cancel", parentCancel);
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    await act(async () => dialog().dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true); expect(parentCancel).not.toHaveBeenCalled(); expect(dialog()).not.toBeNull();
    await act(async () => write.resolve({ ...initial, toast: false })); await settle(); expect(dialog()).toBeNull();
    expect(client.getQueryData(["notification-preferences", account])).toEqual({ ...initial, toast: false });
  });
  it(`keeps the account lock across remount and never closes the replacement dialog (${locale}, ${admin})`, async () => {
    const write = deferred<api.NotificationPreferences>(); vi.mocked(service.savePreferences).mockReturnValue(write.promise);
    await mount(locale, admin); await act(async () => toast().click()); await submit();
    await act(async () => remount()); await settle(); await open();
    expect(toast().disabled).toBe(true); await submit(); expect(service.savePreferences).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve({ ...initial, toast: false })); await settle();
    expect(dialog()).not.toBeNull(); expect(toast().checked).toBe(false); expect(toast().disabled).toBe(false);
  });
  it(`retains edits after a lost response and blocks resubmission until refresh finishes (${locale}, ${admin})`, async () => {
    const write = deferred<api.NotificationPreferences>(), refresh = deferred<api.NotificationPreferences>();
    vi.mocked(service.savePreferences).mockReturnValue(write.promise);
    await mount(locale, admin); await act(async () => toast().click()); await submit();
    vi.mocked(service.preferences).mockReturnValue(refresh.promise);
    await act(async () => write.reject(new Error("response lost"))); await settle();
    expect(toast().disabled).toBe(true); await submit(); expect(service.savePreferences).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve(initial)); await settle();
    expect(dialog()).not.toBeNull(); expect(toast().checked).toBe(false); expect(toast().disabled).toBe(false);
    expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(service.savePreferences).mockResolvedValue({ ...initial, toast: false }); await submit();
    expect(service.savePreferences).toHaveBeenCalledTimes(2); expect(dialog()).toBeNull();
  });
  it(`offers read-only retry after reconciliation fails without losing the draft (${locale}, ${admin})`, async () => {
    await mount(locale, admin); await act(async () => toast().click());
    vi.mocked(service.savePreferences).mockRejectedValue(new Error("response lost"));
    vi.mocked(service.preferences).mockRejectedValue(new Error("read failed")); await submit();
    expect(toast().checked).toBe(false); expect(button("notifications.save", dialog()).disabled).toBe(true);
    vi.mocked(service.preferences).mockResolvedValue(initial);
    await act(async () => button("common.retry", dialog()).click()); await settle();
    expect(toast().checked).toBe(false); expect(button("notifications.save", dialog()).disabled).toBe(false);
    expect(service.savePreferences).toHaveBeenCalledTimes(1);
  });
  for (const failure of [false, true]) it(`ignores old-account ${failure ? "failure" : "success"} (${locale}, ${admin})`, async () => {
    const write = deferred<api.NotificationPreferences>(); vi.mocked(service.savePreferences).mockReturnValue(write.promise);
    await mount(locale, admin); await act(async () => toast().click()); await submit();
    account = "other";
    await act(async () => { window.dispatchEvent(new Event("lw-account-changed")); client.setQueryData([admin ? "admin-me" : "current-user"], { id: account }); }); await settle(); await open();
    const reads = vi.mocked(service.preferences).mock.calls.length;
    await act(async () => { if (failure) write.reject(new Error("late")); else write.resolve({ ...initial, toast: false }); }); await settle();
    expect(dialog()).not.toBeNull(); expect(toast().checked).toBe(true); expect(toast().disabled).toBe(false);
    expect(service.preferences).toHaveBeenCalledTimes(reads); expect(dialog().querySelector('[role="alert"]')).toBeNull();
    expect(client.getQueryData(["notification-preferences", "account"])).toEqual(initial);
  });
}
