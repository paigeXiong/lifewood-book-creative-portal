import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationService as service, type NotificationItem } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { NotificationCenter } from "@lifewood/ui/notifications";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("../../../packages/ui/src/confirmation", () => ({ showConfirmation: confirm }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const item: NotificationItem = { id: 7, kind: "workflow", projectId: "book", projectTitle: "Book", actor: "Editor", createdAt: "2026-09-14T00:00:00Z", read: false, archived: false, state: "info", targetId: "", title: "Book updated", level: "normal" };
let host: HTMLDivElement, root: Root, client: QueryClient, navigate: NavigateFunction;
let remount: () => void;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Fixture({ admin }: { admin: boolean }) {
  const [epoch, setEpoch] = useState(0); remount = () => setEpoch(value => value + 1); navigate = useNavigate();
  return <Routes><Route path="/:locale/notifications" element={<NotificationCenter key={epoch} admin={admin} />} /><Route path="/:locale/other" element={<p>Elsewhere</p>} /></Routes>;
}
beforeEach(() => {
  confirm.mockReset(); confirm.mockResolvedValue(true);
  vi.spyOn(service, "catalog").mockResolvedValue({ retentionDays: 365, items: [] });
  vi.spyOn(service, "list").mockResolvedValue({ items: [item], nextCursor: null, unread: 1, watermark: 42 });
  vi.spyOn(service, "update").mockResolvedValue(undefined);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); vi.restoreAllMocks(); });
async function mount(locale: string, admin: boolean) {
  await i18n.changeLanguage(locale); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData([admin ? "admin-me" : "current-user"], { id: "account" }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications`]}><Fixture admin={admin} /></MemoryRouter></QueryClientProvider>)); await settle();
}
function button(key: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`)!; }
async function select() { await act(async () => button("notifications.enterSelection").click()); await act(async () => host.querySelector<HTMLInputElement>('.notification-list input[type="checkbox"]')!.click()); }

for (const locale of ["zh-CN", "en-US"]) for (const admin of [false, true]) {
  it(`locks confirmation and rejects duplicate writes until reconciliation (${locale}, ${admin})`, async () => {
    const answer = deferred<boolean>(), write = deferred<void>(), refresh = deferred<Awaited<ReturnType<typeof service.list>>>();
    confirm.mockReturnValue(answer.promise); vi.mocked(service.update).mockReturnValue(write.promise);
    await mount(locale, admin); await select();
    await act(async () => { button("notifications.readAll").click(); button("notifications.readAll").click(); button("notifications.readSelected").click(); }); await settle();
    expect(confirm).toHaveBeenCalledTimes(1); expect(service.update).not.toHaveBeenCalled(); expect(button("notifications.archive").disabled).toBe(true);
    await act(async () => answer.resolve(true)); expect(service.update).toHaveBeenCalledExactlyOnceWith("read", undefined, 42);
    vi.mocked(service.list).mockReturnValue(refresh.promise);
    await act(async () => write.resolve()); await settle();
    // Reopening the center must not bypass a write whose refresh is pending.
    await act(async () => remount()); await settle(); expect(button("notifications.enterSelection").disabled).toBe(true);
    await act(async () => refresh.resolve({ items: [{ ...item, read: true }], nextCursor: null, unread: 0, watermark: 42 })); await settle();
    expect(button("notifications.enterSelection").disabled).toBe(false); expect(service.update).toHaveBeenCalledTimes(1);
  });
  it(`discards confirmation after leaving and returning to the same route (${locale}, ${admin})`, async () => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise);
    await mount(locale, admin); await select(); await act(async () => button("notifications.readAll").click());
    await act(async () => navigate(`/${locale}/other`)); await act(async () => navigate(-1)); await settle();
    await act(async () => answer.resolve(true)); await settle(); expect(service.update).not.toHaveBeenCalled(); expect(button("notifications.enterSelection").disabled).toBe(false);
  });
  it(`drops cross-tab stale confirmation before cached account changes (${locale}, ${admin})`, async () => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise);
    await mount(locale, admin); await select(); await act(async () => button("notifications.readAll").click());
    await act(async () => window.dispatchEvent(new Event("lw-account-changed"))); await act(async () => answer.resolve(true)); await settle(); expect(service.update).not.toHaveBeenCalled();
  });
  it(`recovers from confirmation failure and retains selection on a failed write (${locale}, ${admin})`, async () => {
    confirm.mockRejectedValueOnce(new Error("dialog failed")); await mount(locale, admin); await select();
    await act(async () => button("notifications.readAll").click()); await settle(); expect(service.update).not.toHaveBeenCalled(); expect(button("notifications.readSelected").disabled).toBe(false);
    vi.mocked(service.update).mockRejectedValueOnce(new Error("response lost"));
    await act(async () => button("notifications.readSelected").click()); await settle();
    expect(host.querySelector<HTMLInputElement>('.notification-list input[type="checkbox"]')!.checked).toBe(true); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button("common.retry").click()); await settle(); expect(service.update).toHaveBeenLastCalledWith("read", [7], undefined); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(button("notifications.enterSelection"));
  });
  it(`asks again when retrying a failed confirmation (${locale}, ${admin})`, async () => {
    confirm.mockRejectedValueOnce(new Error("dialog failed")).mockResolvedValueOnce(false);
    await mount(locale, admin); await select(); await act(async () => button("notifications.readAll").click()); await settle();
    await act(async () => button("common.retry").click()); await settle();
    expect(confirm).toHaveBeenCalledTimes(2); expect(service.update).not.toHaveBeenCalled(); expect(button("notifications.readSelected").disabled).toBe(false);
  });
  it(`keeps the new account's selection when the old write finishes (${locale}, ${admin})`, async () => {
    const write = deferred<void>(); vi.mocked(service.update).mockReturnValueOnce(write.promise);
    await mount(locale, admin); await select(); await act(async () => button("notifications.readSelected").click());
    await act(async () => client.setQueryData([admin ? "admin-me" : "current-user"], { id: "replacement" })); await settle();
    await vi.waitFor(async () => { await settle(); expect(button("notifications.enterSelection").disabled).toBe(false); });
    await select(); await act(async () => write.resolve()); await settle();
    expect(host.querySelector<HTMLInputElement>('.notification-list input[type="checkbox"]')!.checked).toBe(true); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
}
