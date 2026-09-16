import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { notificationService as service, type NotificationPage } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { NotificationCenter } from "@lifewood/ui/notifications";
import { readNotificationFilters, notificationSearch } from "../../../packages/ui/src/notification-list-state";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, navigate: NavigateFunction;
let path = "";
function Location() { navigate = useNavigate(); const location = useLocation(); path = location.pathname + location.search + location.hash; return null; }
function page(id: number, nextCursor: number | null = null): NotificationPage { return { items: [{ id, kind: "workflow", projectId: "book", projectTitle: "Book", actor: "Editor", createdAt: "2026-09-16T00:00:00Z", read: false, archived: false, state: "info", targetId: "", title: `Notice ${id}`, level: "normal" }], nextCursor, unread: 3, watermark: 42 }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
const settle = async (ms = 30) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
beforeEach(() => { vi.spyOn(service, "catalog").mockResolvedValue({ retentionDays: 365, items: [{ kind: "workflow", titleZh: "进度", titleEn: "Progress", level: "normal", enabled: true, allowMute: true, audience: "responsible", version: 1 }] }); vi.spyOn(service, "update").mockResolvedValue(undefined); });
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); vi.restoreAllMocks(); });
async function mount(locale: string, admin: boolean, search = "", compact = false) {
  await i18n.changeLanguage(locale); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData([admin ? "admin-me" : "current-user"], { id: "account" }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications${search}`]}><Location /><Routes><Route path="/:locale/notifications" element={<NotificationCenter admin={admin} compact={compact} />} /><Route path="/:locale/tasks/book" element={<p>Destination</p>} /></Routes></MemoryRouter></QueryClientProvider>)); await settle();
}
function button(key: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`)!; }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
const rowIds = () => Array.from(host.querySelectorAll('.notification-title')).map(row => row.textContent);
async function loaded(count: number) { for(let attempt=0;attempt<30;attempt++){await settle();if(rowIds().length===count)return;}expect(rowIds()).toHaveLength(count); }

it("validates externally supplied filters and caps the requested restore range", () => {
  const parsed = readNotificationFilters(`?q=${"a".repeat(170)}&kind=<script>&state=bad&from=2026-02-30&to=2026-09-16&unread=1&archived=true&pages=9999999999999999999`);
  expect(parsed).toEqual({ search: "a".repeat(160), project: "", kind: "", state: "", from: "", to: "2026-09-16", unread: false, archived: true, pages: 50 });
  expect(readNotificationFilters("?pages=-3").pages).toBe(1); expect(readNotificationFilters("?pages=2.5").pages).toBe(1);
  expect(readNotificationFilters(notificationSearch(parsed))).toEqual(parsed);
});
for (const locale of ["zh-CN", "en-US"]) for (const admin of [false, true]) {
  it(`restores URL filters and sequential cursor pages after a cold mount (${locale}, ${admin})`, async () => {
    const list = vi.spyOn(service, "list").mockImplementation(async (_, __, cursor) => cursor === 20 ? page(10) : cursor === 30 ? page(20, 20) : page(30, 30));
    await mount(locale, admin, "?q=Book&kind=workflow&state=info&project=book&from=2026-09-01&to=2026-09-16&unread=true&archived=true&pages=3"); await loaded(3);
    expect(list.mock.calls.map(call => call[2])).toEqual([undefined, 30, 20]);
    expect(list).toHaveBeenLastCalledWith(locale, expect.objectContaining({ search: "Book", project: "book", kind: "workflow", state: "info", unread: "true", archived: "true", from: expect.stringContaining("2026-0"), to: expect.stringContaining("2026-09") }), 20);
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("Book");
    expect(host.querySelector<HTMLSelectElement>(`select[aria-label="${i18n.t("notifications.businessState")}"]`)!.value).toBe("info");
    await act(async () => button("notifications.clearFilters").click()); await loaded(1); expect(path).toBe(`/${locale}/notifications`);
    await act(async () => navigate(-1)); await loaded(3); expect(path).toContain("pages=3"); expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("Book");
  });
  it(`keeps page history and recovers after opening a notification (${locale}, ${admin})`, async () => {
    vi.spyOn(service, "list").mockImplementation(async (_, __, cursor) => cursor ? page(20) : page(30, 30));
    vi.spyOn(service, "target").mockResolvedValue({ path: `/${locale}/tasks/book` });
    await mount(locale, admin, "?q=Book"); await loaded(1); await act(async () => { button("notifications.more").click(); button("notifications.more").click(); }); await loaded(2);
    expect(path).toContain("pages=2"); await act(async () => navigate(-1)); await loaded(1); await act(async () => navigate(1)); await loaded(2);
    await act(async () => button("notifications.openProject").click()); await settle(); expect(path).toBe(`/${locale}/tasks/book`);
    await act(async () => navigate(-1)); await loaded(2); expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("Book");
  });
  it(`ignores a pending search after history navigation (${locale}, ${admin})`, async () => {
    const list = vi.spyOn(service, "list").mockResolvedValue(page(30)); await mount(locale, admin, "?q=first"); await loaded(1);
    await act(async () => navigate(`/${locale}/notifications?q=second`)); await loaded(1);
    await change(host.querySelector<HTMLInputElement>('input[type="search"]')!, "stale search"); await act(async () => navigate(-1)); await settle(350);
    expect(path).toBe(`/${locale}/notifications?q=first`); expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("first");
    expect(list.mock.calls.some(call => call[1]?.search === "stale search")).toBe(false);
    await act(async () => navigate(1)); await loaded(1); expect(path).toContain("q=second");
    await change(host.querySelector<HTMLInputElement>('input[type="search"]')!, "typed"); await settle(350); await loaded(1); expect(path).toContain("q=typed");
    await act(async () => navigate(-1)); await loaded(1); expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("second");
    await act(async () => navigate(1)); await loaded(1); expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("typed");
  });
  it(`prevents a late load-more result from overwriting Back/Forward history (${locale}, ${admin})`, async () => {
    const next = deferred<NotificationPage>(); vi.spyOn(service, "list").mockImplementation((_, __, cursor) => cursor ? next.promise : Promise.resolve(page(30, 30)));
    await mount(locale, admin, "?q=first"); await loaded(1); await act(async () => button("notifications.more").click());
    await act(async () => navigate(`/${locale}/notifications?q=second`)); await loaded(1); await act(async () => navigate(-1)); await loaded(1);
    await act(async () => next.resolve(page(20))); await settle(); expect(path).toBe(`/${locale}/notifications?q=first`); expect(rowIds()).toEqual(["Notice 30"]);
    await act(async () => navigate(1)); await loaded(1); expect(path).toContain("q=second");
  });
  it(`keeps compact filters separate and carries them into the full center (${locale}, ${admin})`, async () => {
    const list = vi.spyOn(service, "list").mockResolvedValue(page(30)); await mount(locale, admin, "?q=outside&pages=4", true); await loaded(1);
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
    await change(host.querySelector<HTMLInputElement>('input[type="search"]')!, "  compact  "); await settle(350); await loaded(1);
    expect(path).toContain("q=outside&pages=4"); expect(list).toHaveBeenLastCalledWith(locale, expect.objectContaining({ search: "compact" }), undefined);
    await act(async () => button("notifications.center").click()); await settle(); expect(path).toBe(`/${locale}/notifications?q=compact`);
  });
  for(const cold of [false,true])it(`recovers a failed page without advancing history (${locale}, ${admin}, cold=${cold})`,async()=>{
    let fail=true;
    vi.spyOn(service,"list").mockImplementation(async(_,__,cursor)=>{if(cursor===30){if(fail)throw new Error("offline");return page(20,20);}return cursor===20?page(10):page(30,30);});
    await mount(locale,admin,cold?"?q=Book&pages=3":"?q=Book");await loaded(1);
    if(!cold)await act(async()=>button("notifications.more").click());
    for(let attempt=0;attempt<30&&!host.querySelector('[role="alert"]');attempt++)await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(path).toBe(`/${locale}/notifications?q=Book${cold?"&pages=3":""}`);
    fail=false;await act(async()=>button("common.retry").click());
    if(cold)await loaded(3);else{await settle();await act(async()=>button("notifications.more").click());await loaded(2);expect(path).toContain("pages=2");}
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
}
