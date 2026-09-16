import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { HelpPopover } from "./HelpPopover";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { captureAccountGuard, emailService, localizedApiError } from "@lifewood/api-client";
import "./email.css";

export function EmailSettingsPanel({ userId }: { userId: string }) {
  return <EmailSettingsContent key={userId} userId={userId} />;
}
function EmailSettingsContent({ userId }: { userId: string }) {
  const notificationId = useId();
  const { t } = useTranslation(), client = useQueryClient();
  const query = useQuery({ queryKey: ["email-settings", userId], queryFn: emailService.settings, retry: false, refetchOnWindowFocus: "always", refetchInterval: q => q.state.data?.deliveryStatus === "pending" ? 5000 : false });
  const mutationKey = ["email-settings-action", userId];
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: () => true });
  const [message, setMessage] = useState<string>(), [error, setError] = useState<unknown>(), [invalidated, setInvalidated] = useState(false);
  type Lifetime = { mounted: boolean; accountChanged: boolean };
  const lock = useRef(false), lifetime = useRef<Lifetime | null>(null);
  useEffect(() => {
    const token = { mounted: true, accountChanged: false }; lifetime.current = token;
    const stop = () => { token.accountChanged = true; setInvalidated(true); setMessage(undefined); setError(undefined); };
    window.addEventListener("lw-account-changed", stop);
    return () => { token.mounted = false; lifetime.current = null; window.removeEventListener("lw-account-changed", stop); };
  }, []);
  const operation = useMutation({ mutationKey, retry: false, mutationFn: async ({ action, token, guard }: {
    action: "verify" | boolean; token: Lifetime; guard: () => void;
  }) => {
    const active = () => lifetime.current === token && token.mounted && !token.accountChanged;
    let requested = false;
    try {
      if (!active()) return;
      guard(); requested = true;
      if (action === "verify") await emailService.verify(); else await emailService.preferences(action);
      guard(); if (active()) setMessage(action === "verify" ? "email.queued" : "email.saved");
    } catch (reason) { if (active()) setError(reason); }
    finally {
      // A failed response may have applied the write. Keep the account-wide lock
      // through reconciliation, including after leaving and returning to this page.
      if (requested && !token.accountChanged) {
        try { guard(); await client.invalidateQueries({ queryKey: ["email-settings", userId] }); } catch { /* Query errors expose the refresh retry. */ }
      }
      if (active()) lock.current = false;
    }
  } });
  const busy = pending.length > 0 || query.fetchStatus !== "idle";
  function run(action: "verify" | boolean) {
    const token = lifetime.current;
    if (!token || token.accountChanged || query.fetchStatus !== "idle" || lock.current || client.getMutationCache().findAll({ mutationKey, status: "pending" }).length > 0) return;
    lock.current = true; setError(undefined); setMessage(undefined);
    operation.mutate({ action, token, guard: captureAccountGuard() });
  }
  const data = query.data;
  return <div className="email-settings" aria-busy={busy}>
    {query.isPending ? <p role="status">{t("common.loading")}</p> : query.error ? <p role="alert">{localizedApiError(query.error, t)} <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></p> : data && <>
      <div className="email-setting-row"><span><strong>{t("email.verification")}</strong><small>{t(data.verified ? "email.verified" : "email.unverified")}</small></span>
        {!data.verified && <button type="button" disabled={busy || invalidated || !data.available || data.deliveryStatus === "pending"} onClick={() => run("verify")}>{t("email.sendVerification")}</button>}
      </div>
      {!data.available && <p>{t("email.errors.unavailable")}</p>}
      {data.deliveryStatus && !data.verified && <p role="status">{t("email.delivery." + data.deliveryStatus)}</p>}
      <div className="email-setting-row"><span className="field-help-heading"><label htmlFor={notificationId}><strong>{t("email.notifications")}</strong></label><HelpPopover label={t("email.notifications")}>{t("email.notificationHint")}</HelpPopover></span><input id={notificationId} type="checkbox" role="switch" checked={data.notifications} disabled={busy || invalidated || (!data.notifications && (!data.verified || !data.available))} onChange={e => run(e.target.checked)} /></div>
      {!data.verified && <small>{t("email.errors.verifyFirst")}</small>}
    </>}
    {message && <p role="status">{t(message)}</p>}
    {invalidated ? <p role="alert">{t("accountSwitch.changed")}</p> : error != null && <p role="alert">{localizedApiError(error, t)}</p>}
  </div>;
}

export function ForgotPasswordButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} className="email-forgot" type="button" onClick={() => setOpen(true)}>{t("email.forgot")}</button>{open && <ForgotPasswordDialog onClose={() => { setOpen(false); trigger.current?.focus(); }} />}</>;
}
function ForgotPasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState<unknown>();
  const available = useQuery({ queryKey: ["email-availability"], queryFn: emailService.availability, retry: false });
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await emailService.forgot(email); setSent(true); } catch (reason) { setError(reason); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="email-dialog" aria-labelledby="email-forgot-title" onCancel={e => { if (lock.current) e.preventDefault(); else onClose(); }}>
    <div className="field-help-heading"><h2 id="email-forgot-title">{t("email.forgot")}</h2><HelpPopover label={t("email.forgot")}>{t("email.forgotHint")}</HelpPopover></div>
    {sent ? <p role="status">{t("email.forgotSent")}</p> : <form onSubmit={submit} aria-busy={busy}>
      <label>{t("auth.email")}<input autoFocus type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>
      {available.isPending ? <p role="status">{t("common.loading")}</p> : available.error ? <p role="alert">{localizedApiError(available.error, t)} <button type="button" onClick={() => void available.refetch()}>{t("common.retry")}</button></p> : !available.data?.available && <p>{t("email.errors.unavailable")}</p>}
      {error != null && <p role="alert">{localizedApiError(error, t)}</p>}
      <button type="submit" disabled={busy || !available.data?.available}>{t(busy ? "common.loading" : "email.sendReset")}</button>
    </form>}
    <button type="button" disabled={busy} onClick={onClose}>{t("common.close")}</button>
  </dialog>;
}
