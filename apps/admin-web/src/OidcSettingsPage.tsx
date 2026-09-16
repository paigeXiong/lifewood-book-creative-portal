import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, captureAccountGuard, localizedApiError, oidcService, type OidcConfiguration, type OidcInput } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { SettingsTabs } from "./SettingsTabs";
import { HelpPopover } from "./HelpPopover";
import { useUnsavedClose } from "./useUnsavedClose";
import { useConfirm } from "./useConfirm";
import "./oidc-settings.css";

export function OidcSettingsPage({ locale, allowed }: { locale: SupportedLocale; allowed: boolean }) {
  const { t } = useTranslation(), client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-oidc"], queryFn: oidcService.configuration, enabled: allowed, retry: false });
  const [editing, setEditing] = useState<OidcConfiguration>();
  const [removing, setRemoving] = useState<string>(), [error, setError] = useState<unknown>();
  const lock = useRef(false);
  const newConfiguration: OidcConfiguration = { id: "", version: 0, nameZh: "", nameEn: "", issuer: "", clientId: "", publicOrigin: "", adminOrigin: "", enabled: false, hasSecret: false };
  async function remove(item: OidcConfiguration) {
    if (lock.current) return;
    lock.current = true; setRemoving(item.id); setError(undefined); const guard = captureAccountGuard();
    try { guard(); await oidcService.remove(item.id, item.version); guard(); await client.invalidateQueries({ queryKey: ["admin-oidc"] }); }
    catch (reason) { setError(reason); } finally { lock.current = false; setRemoving(undefined); }
  }
  return <main className="content config-content"><SettingsTabs locale={locale} />
    {!allowed ? <p role="alert">{t("oidc.ownerOnly")}</p> : query.isPending ? <p role="status">{t("common.loading")}</p> : query.error && !query.data ? <p role="alert">{localizedApiError(query.error, t)} <button onClick={() => void query.refetch()}>{t("common.retry")}</button></p> : query.data && <section className="panel oidc-settings">
      {query.error && <p role="alert">{t("recovery.refreshFailed")} <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></p>}
      {editing ? <ConfigurationForm key={editing.id} initial={editing} onCancel={() => setEditing(undefined)} onSaved={data => { setEditing(editing.id ? undefined : data); void client.invalidateQueries({ queryKey: ["admin-oidc"] }); }} /> : <>
        <div className="toolbar"><button disabled={!!removing} onClick={() => setEditing(newConfiguration)}>{t("oidc.add")}</button><HelpPopover label={t("oidc.settings")}>{t("oidc.scopeHint")}</HelpPopover></div>
        {error != null && <p role="alert">{localizedApiError(error, t)}</p>}
        {!query.data.items.length && <p>{t("oidc.noneConfigured")}</p>}
        {query.data.items.map(item => <div className="oidc-provider-row" key={item.id}>
          <div><strong>{locale === "en-US" ? item.nameEn : item.nameZh}</strong><small>{item.issuer}</small></div>
          <span>{t(item.enabled ? "oidc.enabled" : "oidc.disabled")}</span>
          <div className="toolbar"><button disabled={!!removing} onClick={() => setEditing(item)}>{t("oidc.configure")}</button>
            <DeleteProvider item={item} disabled={!!removing} onDelete={() => void remove(item)} />
          </div>
        </div>)}
      </>}
    </section>}
  </main>;
}
function DeleteProvider({ item, disabled, onDelete }: { item: OidcConfiguration; disabled: boolean; onDelete: () => void }) {
  const { t, i18n } = useTranslation(), [confirming, setConfirming] = useState(false);
  return confirming ? <div className="oidc-delete-confirm"><span>{t("oidc.deleteHint", { name: i18n.language === "en-US" ? item.nameEn : item.nameZh })}</span><button disabled={disabled} onClick={onDelete}>{t("oidc.confirmDelete")}</button><button disabled={disabled} onClick={() => setConfirming(false)}>{t("common.cancel")}</button></div> : <button disabled={disabled} onClick={() => setConfirming(true)}>{t("oidc.delete")}</button>;
}

const configurationFields = ["nameZh", "nameEn", "issuer", "clientId", "publicOrigin", "adminOrigin", "enabled"] as const;

function ConfigurationForm({ initial, onCancel, onSaved }: { initial: OidcConfiguration; onCancel: () => void; onSaved: (value: OidcConfiguration) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<OidcInput>({ ...initial, secret: undefined }), [busy, setBusy] = useState(false), [tested, setTested] = useState(false), [error, setError] = useState<unknown>();
  const element = useRef<HTMLFormElement>(null), lock = useRef(false), fieldPrefix = useId();
  const [baseline, setBaseline] = useState(initial), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<OidcConfiguration>(), [missing, setMissing] = useState(false), [recovered, setRecovered] = useState(false);
  const lifetime = useRef<object | null>(null), confirm = useConfirm();
  useEffect(() => { const scope = {}; lifetime.current = scope; return () => { lifetime.current = null; }; }, []);
  const { markDirty, resetDirty, requestClose } = useUnsavedClose(onCancel, t("common.unsavedConfirm"), busy);
  async function run(test: boolean) {
    if (lock.current || conflict || !element.current?.reportValidity()) return;
    lock.current = true; setBusy(true); setError(undefined); setTested(false); const guard = captureAccountGuard();
    const scope = lifetime.current;
    try { guard(); if (test) { await oidcService.test(form); guard(); if (lifetime.current === scope) setTested(true); } else { const data = await oidcService.save(form); guard(); if (lifetime.current === scope) { resetDirty(); onSaved(data); } } }
    catch (reason) { if (lifetime.current === scope) { setError(reason); if (reason instanceof ApiError && reason.details.code === "oidc.conflict") { setConflict(true); setLatest(undefined); setRecovered(false); } } }
    finally { if (lifetime.current === scope) { lock.current = false; setBusy(false); } }
  }
  async function reviewLatest() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined); const scope = lifetime.current, guard = captureAccountGuard();
    try { guard(); const data = await oidcService.configuration(); guard(); if (lifetime.current !== scope) return; const current = data.items.find(item => item.id === initial.id); setLatest(current); setMissing(!current); }
    catch (reason) { if (lifetime.current === scope) setError(reason); }
    finally { if (lifetime.current === scope) { lock.current = false; setBusy(false); } }
  }
  async function applyLatest(keepEdits: boolean) {
    if (lock.current || !latest) return;
    lock.current = true; setBusy(true); const scope = lifetime.current, guard = captureAccountGuard();
    try {
      if (!await confirm(t(keepEdits ? "oidc.recovery.keepConfirm" : "oidc.recovery.replaceConfirm"), false) || lifetime.current !== scope) return;
      guard();
      const next: OidcInput = { ...latest, secret: undefined };
      if (keepEdits) for (const key of configurationFields) if (form[key] !== baseline[key]) Object.assign(next, { [key]: form[key] });
      setForm(next); setBaseline(latest); setLatest(undefined); setConflict(false); setMissing(false); setError(undefined); setTested(false); setRecovered(true);
      if (keepEdits && configurationFields.some(key => next[key] !== latest[key])) markDirty(); else resetDirty();
    } catch (reason) { if (lifetime.current === scope) setError(reason); }
    finally { if (lifetime.current === scope) { lock.current = false; setBusy(false); } }
  }
  const change = (key: keyof OidcInput, value: string | boolean | undefined) => { markDirty(); setForm(current => ({ ...current, [key]: value })); setTested(false); setRecovered(false); };
  const callback = (value: string) => { if (!initial.id) return t("oidc.saveForCallback"); try { return new URL(value).origin + "/api/auth/oidc/callback" + (initial.id === "default" ? "" : "/" + initial.id); } catch { return "—"; } };
  return <form ref={element} onSubmit={(e: FormEvent) => { e.preventDefault(); void run(false); }} aria-busy={busy}>
    <div className="oidc-fields">{(["nameZh", "nameEn", "issuer", "clientId", "publicOrigin", "adminOrigin"] as const).map(key => <div className="oidc-field" key={key}>
      <div className="oidc-field-heading"><label htmlFor={`${fieldPrefix}-${key}`}>{t("oidc.fields." + key)}</label>{(key === "publicOrigin" || key === "adminOrigin") && <HelpPopover label={t("oidc.fields." + key)}>{t("oidc." + key + "Hint")}</HelpPopover>}</div>
      <input id={`${fieldPrefix}-${key}`} type={key === "issuer" || key.endsWith("Origin") ? "url" : "text"} required maxLength={key.startsWith("name") ? 60 : key === "clientId" ? 256 : 500} disabled={busy} value={form[key]} onChange={e => change(key, e.target.value)} />
    </div>)}
      <div className="oidc-field"><div className="oidc-field-heading"><label htmlFor={`${fieldPrefix}-secret`}>{t("oidc.fields.secret")}</label><HelpPopover label={t("oidc.fields.secret")}>{t(baseline.hasSecret ? "oidc.secretRetained" : "oidc.secretHint")}</HelpPopover></div><input id={`${fieldPrefix}-secret`} type="password" autoComplete="new-password" maxLength={4096} value={form.secret ?? ""} disabled={busy} onChange={e => change("secret", e.target.value || undefined)} /></div>
      <label className="check-row"><input type="checkbox" checked={form.enabled} disabled={busy || !initial.id} onChange={e => change("enabled", e.target.checked)} />{t("oidc.enable")}</label>
    </div><div className="oidc-callbacks"><div className="oidc-field-heading"><span>{t("oidc.callbackLabel")}</span><HelpPopover label={t("oidc.callbackLabel")}>{t(initial.id ? "oidc.callbacks" : "oidc.saveForCallback")}</HelpPopover></div>{initial.id ? <><code>{callback(form.publicOrigin)}</code><br /><code>{callback(form.adminOrigin)}</code></> : <span>{t("oidc.callbackPending")}</span>}</div>
    {tested && <p role="status">{t("oidc.tested")}</p>}{error != null && <p role="alert">{localizedApiError(error, t)}</p>}
    {recovered && <p role="status">{t("oidc.recovery.ready")}</p>}
    {conflict && <section className="oidc-conflict" aria-label={t("oidc.recovery.title")}>
      <div className="toolbar"><strong>{t("oidc.recovery.title")}</strong><button type="button" disabled={busy} onClick={() => void reviewLatest()}>{t("oidc.recovery.review")}</button></div>
      {missing && <p role="alert">{t("oidc.recovery.missing")}</p>}
      {latest && <><div className="oidc-comparison"><table><thead><tr><th>{t("oidc.recovery.field")}</th><th>{t("oidc.recovery.mine")}</th><th>{t("oidc.recovery.server")}</th></tr></thead><tbody>{configurationFields.filter(key => form[key] !== latest[key]).map(key => <tr key={key}><th scope="row">{t(key === "enabled" ? "oidc.enable" : "oidc.fields." + key)}</th><td>{typeof form[key] === "boolean" ? t(form[key] ? "oidc.enabled" : "oidc.disabled") : form[key]}</td><td>{typeof latest[key] === "boolean" ? t(latest[key] ? "oidc.enabled" : "oidc.disabled") : latest[key]}</td></tr>)}</tbody></table></div>
        {configurationFields.every(key => form[key] === latest[key]) && <p>{t("oidc.recovery.same")}</p>}
        <div className="toolbar"><button type="button" disabled={busy} onClick={() => void applyLatest(false)}>{t("oidc.recovery.replace")}</button><button type="button" disabled={busy} onClick={() => void applyLatest(true)}>{t("oidc.recovery.keep")}</button></div></>}
    </section>}
    <div className="toolbar"><button type="button" disabled={busy || conflict} onClick={() => void run(true)}>{t("oidc.test")}</button><HelpPopover label={t("oidc.test")}>{t("oidc.testHint")}</HelpPopover><button type="submit" disabled={busy || conflict}>{t("oidc.save")}</button><button type="button" disabled={busy} onClick={() => void requestClose()}>{t("common.cancel")}</button></div>
  </form>;
}
