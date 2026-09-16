import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { captureAccountGuard, localizedApiError, oidcService, type OidcBindingStatus } from "@lifewood/api-client";
import "./email.css";
import { followOidc } from "./oidc-navigation";
import { HelpPopover } from "./HelpPopover";
export { followOidc } from "./oidc-navigation";

function useOidcActionScope() {
  const scope = useRef<AbortController | null>(null);
  const [invalidated, setInvalidated] = useState(false);
  useEffect(() => {
    const token = new AbortController(); scope.current = token;
    const stop = () => { token.abort(); setInvalidated(true); };
    window.addEventListener("lw-account-changed", stop);
    return () => { token.abort(); scope.current = null; window.removeEventListener("lw-account-changed", stop); };
  }, []);
  const capture = () => {
    const token = scope.current;
    return () => token !== null && scope.current === token && !token.signal.aborted;
  };
  return { capture, invalidated };
}

export function OidcOutcome() {
  const { t } = useTranslation(), location = useLocation();
  const outcome = new URLSearchParams(location.search).get("oidc");
  return outcome && ["failed", "unbound", "binding", "bound"].includes(outcome) ? <p role={outcome === "bound" ? "status" : "alert"}>{t(outcome === "bound" ? "oidc.boundDone" : "oidc.errors." + outcome)}</p> : null;
}
export function OtherLoginMethods({ portal }: { portal: "customer" | "admin" }) {
  const location = useLocation();
  return <LoginMethods key={`${location.key}:${portal}`} portal={portal} />;
}
function LoginMethods({ portal }: { portal: "customer" | "admin" }) {
  const { t, i18n } = useTranslation();
  const { capture, invalidated } = useOidcActionScope();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const lock = useRef(false), optionsId = useId();
  const query = useQuery({ queryKey: ["oidc-providers"], queryFn: oidcService.providers, enabled: open, retry: false });
  async function login(providerId: string) {
    const active = capture();
    if (lock.current || !active()) return; lock.current = true; setBusy(true); setError(undefined);
    const guard = captureAccountGuard();
    try { guard(); const result = await oidcService.start(i18n.language === "en-US" ? "en-US" : "zh-CN", portal, providerId); if (!active()) return; guard(); followOidc(result.url); }
    catch (reason) { if (active()) { setError(reason); lock.current = false; setBusy(false); } }
  }
  return <div className="oidc-login"><OidcOutcome />{invalidated && <p role="alert">{t("accountSwitch.changed")}</p>}<div className="field-help-heading"><button type="button" className="oidc-toggle" aria-controls={optionsId} aria-expanded={open} disabled={busy || invalidated} onClick={() => setOpen(value => !value)}>{t("oidc.other")}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m7 10 5 5 5-5" /></svg></button><HelpPopover label={t("oidc.other")}>{t("oidc.loginHint")}</HelpPopover></div>
    {open && <div id={optionsId} className="email-settings">{query.isPending ? <p role="status">{t("common.loading")}</p> : query.error ? <p role="alert">{localizedApiError(query.error, t)} <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></p> : query.data?.items.length ? <>
      <div className="oidc-provider-options">{query.data.items.map(item => <button type="button" disabled={busy || invalidated} key={item.id} onClick={() => void login(item.id)}>{busy && !invalidated ? t("common.loading") : i18n.language === "en-US" ? item.nameEn : item.nameZh}</button>)}</div></> : <p>{t("oidc.none")}</p>}
      {error != null && <p role="alert">{localizedApiError(error, t)}</p>}
    </div>}
  </div>;
}
export function OidcBinding({ userId }: { userId: string }) {
  const location = useLocation();
  return <BindingSettings key={`${location.key}:${userId}`} userId={userId} />;
}
function BindingSettings({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation(), client = useQueryClient();
  const query = useQuery({ queryKey: ["oidc-binding", userId], queryFn: oidcService.binding, retry: false, refetchOnWindowFocus: "always" });
  const [selected, setSelected] = useState<OidcBindingStatus>(); const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => { setSelected(undefined); trigger.current?.focus(); };
  return <div className="email-settings"><OidcOutcome />
    {query.error ? <p role="alert">{localizedApiError(query.error, t)} <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></p> : query.isPending ? <p role="status">{t("common.loading")}</p> : query.data?.items.length ? query.data.items.map(item => <div className="email-setting-row" key={item.id}><span><strong>{i18n.language === "en-US" ? item.nameEn : item.nameZh}</strong><small>{t(item.bound ? "oidc.bound" : "oidc.notBound")}{!item.available && ` · ${t("oidc.disabled")}`}</small></span>
      <button type="button" onClick={event => { trigger.current = event.currentTarget; setSelected(item); }}>{t(item.bound ? "oidc.unbind" : "oidc.bind")}</button>
    </div>) : <p>{t("oidc.none")}</p>}
    {selected && <BindingDialog key={selected.id} provider={selected} locale={i18n.language === "en-US" ? "en-US" : "zh-CN"} onClose={close} onSaved={() => { close(); void client.invalidateQueries({ queryKey: ["oidc-binding", userId] }); }} />}
  </div>;
}
function BindingDialog({ provider, locale, onClose, onSaved }: { provider: OidcBindingStatus; locale: string; onClose: () => void; onSaved: () => void }) {
  const bound = provider.bound;
  const { capture, invalidated } = useOidcActionScope();
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (invalidated) { setPassword(""); setBusy(false); lock.current = false; } }, [invalidated]);
  async function submit(event: FormEvent) {
    event.preventDefault(); const active = capture(); if (lock.current || !active()) return; lock.current = true; setBusy(true); setError(undefined); const guard = captureAccountGuard();
    try { guard(); if (bound) { await oidcService.unbind(password, provider.id); if (!active()) return; guard(); onSaved(); } else { const result = await oidcService.start(locale, "customer", provider.id, password); if (!active()) return; guard(); followOidc(result.url); } }
    catch (reason) { if (active()) { setError(reason); setBusy(false); lock.current = false; } }
  }
  return <dialog ref={dialog} className="email-dialog" aria-labelledby="oidc-bind-title" onCancel={e => { if (lock.current) e.preventDefault(); else onClose(); }}>
    <h2 id="oidc-bind-title">{t(bound ? "oidc.unbind" : "oidc.bind")}</h2><div className="field-help-heading"><strong>{locale === "en-US" ? provider.nameEn : provider.nameZh}</strong>{!bound && <HelpPopover label={t("oidc.bind")}>{t("oidc.bindHint")}</HelpPopover>}</div>{bound && <p>{t("oidc.unbindHint")}</p>}
    <form onSubmit={submit} aria-busy={busy}><label>{t("auth.password")}<input autoFocus type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy || invalidated} onChange={e => setPassword(e.target.value)} /></label>
      {invalidated ? <p role="alert">{t("accountSwitch.changed")}</p> : error != null && <p role="alert">{localizedApiError(error, t)}</p>}<button type="submit" disabled={busy || invalidated}>{t(busy ? "common.loading" : bound ? "oidc.unbind" : "oidc.continue")}</button>
    </form><button type="button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
  </dialog>;
}
