import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { captureAccountGuard, loginDeviceService, localizedApiError, type LoginDevice } from "@lifewood/api-client";
import "./saved-views.css";

type Lifetime = { mounted: boolean; accountChanged: boolean };
export function LoginSessions({ userId }: { userId: string }) {
  return <DeviceSessions key={userId} userId={userId} />;
}
function DeviceSessions({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation(), client = useQueryClient(), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [target, setTarget] = useState<LoginDevice | "others" | null>(null);
  const [error, setError] = useState<unknown>(), [invalidated, setInvalidated] = useState(false);
  const lock = useRef(false), lifetime = useRef<Lifetime | null>(null);
  const query = useQuery({ queryKey: ["login-devices", userId, page], queryFn: () => loginDeviceService.list(page), enabled: open, retry: false, refetchInterval: open ? 30000 : false });
  const mutationKey = ["login-devices-revoke", userId];
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: () => true });
  const busy = pending.length > 0;
  const unavailable = busy || invalidated || query.isPending || Boolean(query.error) || query.fetchStatus !== "idle";
  const targetExists = target === "others" ? (query.data?.total ?? 0) > 1 : target !== null && Boolean(query.data?.items.some(item => item.id === target.id && !item.current));
  useEffect(() => {
    const token = { mounted: true, accountChanged: false }; lifetime.current = token;
    const stop = () => { token.accountChanged = true; setInvalidated(true); setTarget(null); setError(undefined); };
    window.addEventListener("lw-account-changed", stop);
    return () => { token.mounted = false; lifetime.current = null; window.removeEventListener("lw-account-changed", stop); };
  }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => { if (query.error || !targetExists) setTarget(null); }, [query.error, targetExists]);
  const revoke = useMutation({ mutationKey, retry: false, mutationFn: async ({ id, token, guard }: {
    id: string | null; token: Lifetime; guard: () => void;
  }) => {
    const active = () => lifetime.current === token && token.mounted && !token.accountChanged;
    let requested = false;
    try {
      if (!active()) return;
      guard(); requested = true;
      if (id === null) await loginDeviceService.revokeOthers(); else await loginDeviceService.revoke(id);
      guard(); if (active()) setPage(1);
    } catch (reason) { if (active()) setError(reason); }
    finally {
      if (active()) setTarget(null);
      // A lost response may still have revoked the session. Reconcile before
      // accepting another confirmation, including after the panel remounts.
      if (requested && !token.accountChanged) {
        try { guard(); await client.invalidateQueries({ queryKey: ["login-devices", userId] }); } catch { /* The list exposes its read retry. */ }
      }
      if (active()) lock.current = false;
    }
  } });
  const submit = () => {
    const token = lifetime.current;
    if (!open || unavailable || !targetExists || !target || !token || token.accountChanged || lock.current || client.getMutationCache().findAll({ mutationKey, status: "pending" }).length > 0) return;
    lock.current = true; setError(undefined);
    revoke.mutate({ id: target === "others" ? null : target.id, token, guard: captureAccountGuard() });
  };
  const movePage = (next: number) => { setTarget(null); setError(undefined); setPage(next); };
  const date = (value?: string) => value ? new Date(value).toLocaleString(i18n.language) : t("userActivity.noData");
  return <><button type="button" className="login-devices-trigger" disabled={invalidated} onClick={() => { setOpen(true); setPage(1); setTarget(null); setError(undefined); }}>{t("productivity.devices")}</button>{open && <dialog aria-label={t("productivity.devices")} ref={dialog} className="saved-views-dialog login-devices-dialog" onCancel={e => { if (busy && !invalidated) e.preventDefault(); else setOpen(false); }}>
    <h2>{t("productivity.devices")}</h2>
    {query.isPending ? <p role="status">{t("common.loading")}</p> : query.error ? <p role="alert">{localizedApiError(query.error, t)}<button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></p> : <ul>{query.data?.items.map(item => <li key={item.id} style={{ alignItems: "start", flexWrap: "wrap" }}><div style={{ flex: 1, minWidth: 180 }}><strong>{t("productivity.browsers." + item.browser)} · {t("productivity.platforms." + item.platform)}</strong>{item.current && <small> · {t("productivity.currentDevice")}</small>}<p style={{ fontSize: 12, margin: "5px 0" }}>{t("productivity.connectedAt")} · {date(item.lastSeen)}</p><small>{t("productivity.expiresAt")} · {date(item.expiresAt)}</small></div>{!item.current && <button type="button" disabled={unavailable} onClick={() => { setTarget(item); setError(undefined); }}>{t("productivity.revoke")}</button>}</li>)}</ul>}
    {target && targetExists && !query.error && <section role="alert"><p>{t(target === "others" ? "productivity.revokeOthersConfirm" : "productivity.revokeConfirm")}</p><button type="button" disabled={unavailable} onClick={submit}>{t("productivity.revoke")}</button><button type="button" disabled={busy} onClick={() => setTarget(null)}>{t("common.cancel")}</button></section>}
    {invalidated ? <p role="alert">{t("accountSwitch.changed")}</p> : error != null && <p role="alert">{localizedApiError(error, t)}</p>}
    <footer style={{ gap: 6, flexWrap: "wrap" }}>{((query.data?.total ?? 0) > 20 || page > 1) && <><button type="button" disabled={page <= 1 || unavailable} onClick={() => movePage(page - 1)}>{t("operations.previous")}</button><button type="button" disabled={!query.data || page * 20 >= query.data.total || unavailable} onClick={() => movePage(page + 1)}>{t("operations.next")}</button></>}<button type="button" disabled={unavailable || !query.data || query.data.total < 2} onClick={() => { setTarget("others"); setError(undefined); }}>{t("productivity.revokeOthers")}</button><button type="button" disabled={busy && !invalidated} onClick={() => setOpen(false)}>{t("common.close")}</button></footer>
  </dialog>}</>;
}
