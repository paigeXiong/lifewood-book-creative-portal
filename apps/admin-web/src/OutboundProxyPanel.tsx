import { useEffect, useRef, useState, type FormEvent } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { captureAccountGuard, localizedApiError, outboundProxyService, type ProxyInput, type ProxyScope, type ProxySettings } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";
import { useUnsavedClose } from "./useUnsavedClose";
import { showAdminToast } from "./Toast";
import "./outbound-proxy.css";

export function OutboundProxyPanel({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["admin-outbound-proxy", locale], queryFn: ({ signal }) => outboundProxyService.get(locale, signal), retry: false });
  const [editing, setEditing] = useState<{ settings: ProxySettings; scope: ProxyScope }>();
  const busy = useIsMutating({ mutationKey: ["admin-outbound-proxy-write"] }) > 0;
  const data = query.data;
  return <section className="runtime-card outbound-proxy-panel">
    <div className="runtime-card-heading"><div className="runtime-help-heading"><h2>{t("outboundProxy.title")}</h2>{data && <HelpPopover label={t("outboundProxy.title")}>{data.labels.help}</HelpPopover>}</div></div>
    {query.isPending && <p role="status">{t("common.loading")}</p>}
    {query.isError && <p role="alert">{localizedApiError(query.error, t)} <button type="button" disabled={query.isFetching || busy} onClick={() => void query.refetch()}>{t("common.retry")}</button></p>}
    {data && <ul className="outbound-proxy-scopes">{data.scopes.map(scope => <li key={scope.id}>
      <div><strong>{scope.label}</strong><span>{data.modes.find(m => m.id === scope.mode)?.label}{scope.mode === "inherit" && ` · ${data.modes.find(m => m.id === scope.effectiveMode)?.label}`}</span></div>
      <button type="button" disabled={busy || query.isError} onClick={() => setEditing({ settings: data, scope })} aria-label={`${t("outboundProxy.configure")} · ${scope.label}`}>{t("outboundProxy.configure")}</button>
    </li>)}</ul>}
    {editing && <ProxyEditor key={editing.scope.id} initial={editing.settings} scope={editing.scope} locale={locale} onClose={() => setEditing(undefined)} />}
  </section>;
}

function ProxyEditor({ initial, scope, locale, onClose }: { initial: ProxySettings; scope: ProxyScope; locale: SupportedLocale; onClose: () => void }) {
  const { t } = useTranslation(), client = useQueryClient();
  // Locale refreshes may update labels, but must never replace an unsaved draft.
  const labels = useQuery({ queryKey: ["admin-outbound-proxy", locale], queryFn: ({ signal }) => outboundProxyService.get(locale, signal), retry: false }).data ?? initial;
  const l = labels.labels;
  const [form, setForm] = useState<ProxyInput>({ revision: initial.revision, scope: scope.id, mode: scope.mode, address: scope.address, username: scope.username, password: "", clearPassword: false });
  const [status, setStatus] = useState<number>();
  const mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = useMutation({ mutationKey: ["admin-outbound-proxy-write"], mutationFn: (input: ProxyInput) => outboundProxyService.save(input, locale), retry: false, gcTime: 0, networkMode: "always" });
  const test = useMutation({ mutationKey: ["admin-outbound-proxy-write"], mutationFn: () => outboundProxyService.test(initial.revision, scope.id), retry: false, networkMode: "always" });
  const busy = save.isPending || test.isPending;
  const controls = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const changed = form.mode !== scope.mode || form.address !== scope.address || form.username !== scope.username || !!form.password || form.clearPassword;
  function edit(next: ProxyInput) { setForm(next); controls.markDirty(); setStatus(undefined); test.reset(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked.current || !changed) return;
    locked.current = true; const guard = captureAccountGuard();
    try {
      await save.mutateAsync(form); guard(); if (!mounted.current) return;
      controls.resetDirty(); void client.invalidateQueries({ queryKey: ["admin-outbound-proxy"] }); showAdminToast(t("outboundProxy.saved")); onClose();
    } catch { /* Keep the draft and localized error visible; never retry writes. */ }
    finally { locked.current = false; }
  }
  async function check() {
    if (locked.current || changed) return;
    locked.current = true; const guard = captureAccountGuard(); setStatus(undefined);
    try { const result = await test.mutateAsync(); guard(); if (mounted.current) setStatus(result.status); }
    catch { /* Redacted diagnostic only. */ }
    finally { locked.current = false; }
  }
  return <ModalFrame labelledBy="proxy-editor-title" className="outbound-proxy-dialog" busy={busy} onClose={() => void controls.requestClose()}>
    <div className="runtime-help-heading"><h2 id="proxy-editor-title">{t("outboundProxy.title")} · {labels.scopes.find(s => s.id === scope.id)?.label ?? scope.label}</h2><HelpPopover label={t("outboundProxy.title")}>{l.help}</HelpPopover></div>
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        <label>{l.mode}<select value={form.mode} onChange={e => edit({ ...form, mode: e.target.value, password: "", clearPassword: false })}>{labels.modes.filter(m => scope.id !== "global" || m.id !== "inherit").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        {form.mode === "inherit" && <p>{l.effective}: {labels.modes.find(m => m.id === labels.scopes.find(s => s.id === "global")?.mode)?.label}</p>}
        {form.mode === "custom" && <>
          <label>{l.address}<input type="url" required maxLength={2048} autoComplete="off" placeholder="http://127.0.0.1:7890" value={form.address} onChange={e => edit({ ...form, address: e.target.value })} /></label>
          <label>{l.username}<input maxLength={254} autoComplete="off" disabled={form.clearPassword} value={form.username} onChange={e => edit({ ...form, username: e.target.value })} /></label>
          <div className="runtime-help-heading"><label htmlFor="proxy-password">{l.password}</label><HelpPopover label={l.password}>{l.passwordHelp}</HelpPopover></div>
          <input id="proxy-password" type="password" autoComplete="new-password" maxLength={4096} disabled={form.clearPassword} placeholder={scope.hasPassword ? l.savedPassword : undefined} value={form.password} onChange={e => edit({ ...form, password: e.target.value })} />
          {scope.hasPassword && <label className="outbound-proxy-clear"><input type="checkbox" checked={form.clearPassword} onChange={e => edit({ ...form, clearPassword: e.target.checked, username: e.target.checked ? "" : scope.username, password: "" })} />{l.clearPassword}</label>}
        </>}
      </fieldset>
      {(save.error || test.error) && <p role="alert">{localizedApiError(save.error ?? test.error, t)}</p>}
      {status !== undefined && <p role="status">{t("outboundProxy.connected", { status })}</p>}
      <div className="outbound-proxy-actions">
        {scope.id !== "global" && <div className="runtime-help-heading"><button type="button" disabled={busy || changed} onClick={() => void check()}>{t(test.isPending ? "outboundProxy.testing" : "outboundProxy.test")}</button><HelpPopover label={t("outboundProxy.test")}>{l.testHelp}</HelpPopover></div>}
        <button type="button" disabled={busy} onClick={() => void controls.requestClose()}>{t("common.close")}</button>
        <button className="primary" type="submit" disabled={busy || !changed}>{t(save.isPending ? "outboundProxy.saving" : "common.save")}</button>
      </div>
    </form>
  </ModalFrame>;
}
