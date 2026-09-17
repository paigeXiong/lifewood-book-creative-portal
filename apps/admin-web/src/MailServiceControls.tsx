import { useEffect, useRef, useState, type FormEvent } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, captureAccountGuard, localizedApiError, mailSettingsService, type MailServiceInput, type MailServiceSettings } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";
import { useUnsavedClose } from "./useUnsavedClose";
import { useConfirm } from "./useConfirm";
import { showAdminToast } from "./Toast";

export function MailServiceControls({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const busy = useIsMutating({ mutationKey: ["admin-mail-service-write"] }) > 0;
  return <>
    <button type="button" disabled={busy} onClick={() => setOpen(true)}>{t("mailService.configure")}</button>
    {open && <MailServiceDialog locale={locale} onClose={() => setOpen(false)} />}
  </>;
}

function MailServiceDialog({ locale, onClose }: { locale: SupportedLocale; onClose: () => void }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["admin-mail-settings", locale], queryFn: ({ signal }) => mailSettingsService.get(locale, signal), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false, placeholderData: previous => previous });
  const lastData = useRef<MailServiceSettings | undefined>(undefined);
  if (query.data) lastData.current = query.data;
  const data = query.data ?? lastData.current;
  if (!data) return <ModalFrame labelledBy="mail-settings-title" onClose={onClose}>
    <h2 id="mail-settings-title">{t("mailService.title")}</h2>
    {query.isPending ? <p role="status">{t("common.loading")}</p> : <p role="alert">{localizedApiError(query.error, t)} <button disabled={query.isFetching} onClick={() => void query.refetch()}>{t("common.retry")}</button></p>}
    <button onClick={onClose}>{t("common.close")}</button>
  </ModalFrame>;
  return <MailServiceEditor initial={data} locale={locale} onClose={onClose} reload={() => query.refetch()} readError={query.error} />;
}

function MailServiceEditor({ initial, locale, onClose, reload, readError }: { initial: MailServiceSettings; locale: SupportedLocale; onClose: () => void; reload: () => Promise<unknown>; readError: Error | null }) {
  const { t } = useTranslation(), client = useQueryClient();
  const l = initial.labels;
  const [baseline, setBaseline] = useState(initial);
  const confirm = useConfirm();
  const [form, setForm] = useState<MailServiceInput>(() => ({ revision: baseline.revision, enabled: baseline.enabled, host: baseline.host, port: baseline.port, from: baseline.from, username: baseline.username, password: "", clearPassword: false, publicUrl: baseline.publicUrl }));
  const [confirmTest, setConfirmTest] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = useMutation({ mutationKey: ["admin-mail-service-write"], networkMode: "always", retry: false, gcTime: 0,
    mutationFn: (input: MailServiceInput) => mailSettingsService.save(input, locale) });
  const test = useMutation({ mutationKey: ["admin-mail-service-write"], networkMode: "always", retry: false,
    mutationFn: () => mailSettingsService.test(baseline.revision, locale) });
  const busy = save.isPending || test.isPending || reloading;
  const controls = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const changed = form.enabled !== baseline.enabled || form.host !== baseline.host || form.port !== baseline.port || form.from !== baseline.from || form.username !== baseline.username || form.publicUrl !== baseline.publicUrl || !!form.password || form.clearPassword;
  const testHint = test.error instanceof ApiError ? test.error.details.messageKey?.replace("mailService.errors.", "mailService.hints.") : undefined;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked.current || refreshFailed) return;
    locked.current = true; const guard = captureAccountGuard();
    try {
      const result = await save.mutateAsync(form); guard(); if (!mounted.current) return;
      await client.cancelQueries({ queryKey: ["admin-mail-settings"] }); guard(); if (!mounted.current) return;
      client.removeQueries({ queryKey: ["admin-mail-settings"] });
      void client.invalidateQueries({ queryKey: ["admin-mail-queue"] });
      void client.invalidateQueries({ queryKey: ["email-availability"] });
      controls.resetDirty(); showAdminToast(result.labels.saved); onClose();
    } catch { /* Localized errors remain in the editor; never retry writes automatically. */ }
    finally { locked.current = false; }
  }
  async function sendTest() {
    if (locked.current) return;
    locked.current = true; const guard = captureAccountGuard();
    try { await test.mutateAsync(); guard(); if (mounted.current) { setConfirmTest(false); setNotice(l.testAccepted); } }
    catch { /* Show a redacted error; a failed response may still mean SMTP accepted it. */ }
    finally { locked.current = false; }
  }
  async function reloadSettings() {
    if (locked.current) return;
    if (changed && !await confirm(t("common.unsavedConfirm"), false)) return;
    if (!mounted.current || locked.current) return;
    locked.current = true; setReloading(true);
    try {
      const result = await reload() as { isError?: boolean; data?: MailServiceSettings };
      if (mounted.current) {
        setRefreshFailed(!!result.isError);
        if (!result.isError && result.data) {
          const value = result.data;
          setBaseline(value);
          setForm({ revision: value.revision, enabled: value.enabled, host: value.host, port: value.port, from: value.from, username: value.username, password: "", clearPassword: false, publicUrl: value.publicUrl });
          controls.resetDirty(); save.reset();
        }
      }
    }
    finally { locked.current = false; if (mounted.current) setReloading(false); }
  }
  if (confirmTest) return <ModalFrame labelledBy="mail-test-title" busy={busy} onClose={() => setConfirmTest(false)}>
      <h2 id="mail-test-title">{l.testTitle}</h2><p>{l.testBody}</p><p><strong>{baseline.from}</strong></p>
      {test.error && <div className="mail-service-test-error"><p role="alert">{localizedApiError(test.error, t)}</p>{testHint && testHint.startsWith("mailService.hints.") && t(testHint) !== testHint && <HelpPopover label={l.test}>{t(testHint)}</HelpPopover>}</div>}
      <div className="mail-service-footer"><button disabled={busy} onClick={() => setConfirmTest(false)}>{l.cancel}</button><button disabled={busy} onClick={() => void sendTest()}>{l.test}</button></div>
    </ModalFrame>;
  return <ModalFrame labelledBy="mail-settings-title" className="mail-service-dialog" busy={busy} onClose={() => void controls.requestClose()}>
    <div className="mail-service-heading"><h2 id="mail-settings-title">{l.title}</h2><HelpPopover label={l.title}>{l.help}</HelpPopover></div>
    <form onSubmit={event => void submit(event)} onChange={controls.markDirty}>
      <fieldset disabled={busy} className="mail-service-fields">
        <label className="mail-service-enabled"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />{l.enabled}</label>
        <div className="mail-service-field"><div><label htmlFor="mail-host">{l.host}</label><HelpPopover label={l.host}>{l.smtpHelp}</HelpPopover></div><input id="mail-host" required={form.enabled} maxLength={253} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} autoComplete="off" /></div>
        <label>{l.port}<input type="number" min={1} max={65535} required value={form.port || ""} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></label>
        <label>{l.from}<input type="email" required={form.enabled} maxLength={254} value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} autoComplete="off" /></label>
        <label>{l.username}<input maxLength={254} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" /></label>
        <div className="mail-service-field"><div><label htmlFor="mail-password">{l.password}</label><HelpPopover label={l.password}>{l.passwordHelp}</HelpPopover></div><input id="mail-password" type="password" maxLength={4096} value={form.password} disabled={form.clearPassword} placeholder={baseline.hasPassword ? l.passwordSaved : undefined} autoComplete="new-password" onChange={e => setForm({ ...form, password: e.target.value })} /></div>
        {baseline.hasPassword && <label className="mail-service-clear"><input type="checkbox" checked={form.clearPassword} onChange={e => setForm({ ...form, clearPassword: e.target.checked, password: "" })} />{l.clearPassword}</label>}
        <div className="mail-service-field mail-service-domain"><div><label htmlFor="mail-public-url">{l.publicUrl}</label><HelpPopover label={l.publicUrl}>{l.domainHelp}</HelpPopover></div><input id="mail-public-url" type="url" required={form.enabled} maxLength={2048} value={form.publicUrl} onChange={e => setForm({ ...form, publicUrl: e.target.value })} /></div>
      </fieldset>
      {save.error && <p role="alert">{localizedApiError(save.error, t)}</p>}
      {readError && <p role="alert">{t("recovery.refreshFailed")}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="mail-service-footer">
        <div><button type="button" disabled={busy || changed || !baseline.available} onClick={() => { test.reset(); setNotice(""); setConfirmTest(true); }}>{l.test}</button><HelpPopover label={l.test}>{l.testHelp}</HelpPopover></div>
        <div><button type="button" disabled={busy} onClick={() => void controls.requestClose()}>{l.cancel}</button><button type="submit" disabled={busy || refreshFailed} className="primary">{l.save}</button></div>
      </div>
      {(save.error || readError) && <button type="button" disabled={busy} onClick={() => void reloadSettings()}>{l.reload}</button>}
    </form>

  </ModalFrame>;
}
