import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export const maxNotificationPages = 50;
export const emptyNotificationFilters = { search: "", kind: "", state: "", project: "", from: "", to: "", unread: false, archived: false, pages: 1 };
export type NotificationFilters = typeof emptyNotificationFilters;
export function notificationDate(value: string, end = false): string | null {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(date.getTime()) && date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date.toISOString() : null;
}
export function readNotificationFilters(search: string): NotificationFilters {
  const p = new URLSearchParams(search), kind = p.get("kind") ?? "", state = p.get("state") ?? "", pages = p.get("pages") ?? "1";
  const date = (key: string) => { const value = p.get(key) ?? ""; return notificationDate(value) === null ? "" : value; };
  return {
    search: (p.get("q") ?? "").trim().slice(0, 160), project: (p.get("project") ?? "").trim().slice(0, 160),
    kind: /^[a-z][a-z0-9_]{0,79}$/.test(kind) ? kind : "", state: ["pending", "done", "info", "expired"].includes(state) ? state : "",
    from: date("from"), to: date("to"), unread: p.get("unread") === "true", archived: p.get("archived") === "true",
    pages: /^[1-9]\d*$/.test(pages) ? Math.min(maxNotificationPages, Number(pages)) : 1,
  };
}
export function notificationSearch(value: NotificationFilters) {
  const p = new URLSearchParams();
  if (value.search.trim()) p.set("q", value.search.trim().slice(0, 160));
  for (const key of ["kind", "state", "project", "from", "to"] as const) if (value[key].trim()) p.set(key, value[key].trim());
  if (value.unread) p.set("unread", "true");
  if (value.archived) p.set("archived", "true");
  if (value.pages > 1) p.set("pages", String(value.pages));
  return p.size ? `?${p}` : "";
}

export function useNotificationListState(compact: boolean, user: string) {
  const location = useLocation(), navigate = useNavigate();
  const scope = JSON.stringify([user, compact, location.key]);
  const [local, setLocal] = useState({ user, value: emptyNotificationFilters });
  const committed = compact ? (local.user === user ? local.value : emptyNotificationFilters) : readNotificationFilters(location.search);
  const [draft, setDraft] = useState<{ scope: string; value: NotificationFilters }>();
  const value = draft?.scope === scope ? draft.value : committed;
  const current = useRef({ scope, value }); current.current = { scope, value };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), alive = useRef(false);
  // A fresh token also distinguishes Back/Forward to an identical earlier URL.
  const identity = JSON.stringify([scope, value]);
  const view = useRef({ identity, token: {} });
  if (view.current.identity !== identity) view.current = { identity, token: {} };
  useEffect(() => {
    alive.current = true; setDraft(undefined);
    const stop = () => { clearTimeout(timer.current); alive.current = false; };
    window.addEventListener("lw-account-changed", stop);
    return () => { stop(); window.removeEventListener("lw-account-changed", stop); };
  }, [scope]);
  const commit = (next: NotificationFilters) => {
    if (!alive.current || current.current.scope !== scope) return;
    if (compact) { setLocal({ user, value: readNotificationFilters(notificationSearch(next)) }); setDraft(undefined); }
    else if (notificationSearch(next) !== notificationSearch(committed)) {
      setDraft(undefined);
      void navigate(location.pathname + notificationSearch(next) + location.hash, { state: location.state, flushSync: true });
    } else setDraft(undefined);
  };
  const setFilters = (patch: Partial<NotificationFilters>, debounce = false) => {
    clearTimeout(timer.current);
    const next = { ...current.current.value, pages: 1, ...patch };
    current.current = { scope, value: next }; setDraft({ scope, value: next });
    if (debounce) timer.current = setTimeout(() => commit(next), 300);
    else commit(next);
  };
  return { value, committed, setFilters, token: view.current.token, isCurrent: (token: object) => alive.current && view.current.token === token };
}
