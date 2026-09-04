import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { RuntimeSettings, SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { SettingsTabs } from "./SettingsTabs";
import { showAdminToast } from "./Toast";

type RuntimeAction = "restart" | "shutdown";

function endpoint(scheme: "http" | "https", address: string, port: number, currentHostname?: string) {
  const displayAddress =
    address === "0.0.0.0" || address === "::" ? (currentHostname ?? window.location.hostname) : address;
  const normalizedAddress = displayAddress.startsWith("[") && displayAddress.endsWith("]")
    ? displayAddress.slice(1, -1)
    : displayAddress;
  const host = normalizedAddress.includes(":") ? `[${normalizedAddress}]` : normalizedAddress;
  return `${scheme}://${host}:${port}`;
}

export function runtimeAdminUrl(
  settings: Pick<RuntimeSettings, "scheme" | "listenAddress" | "port">,
  locale: SupportedLocale,
  currentHostname?: string,
) {
  return endpoint(settings.scheme, settings.listenAddress, settings.port, currentHostname) + "/admin/" + locale + "/settings/runtime";
}

export function SystemRuntimePage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-runtime-settings"], queryFn: adminService.getRuntimeSettings });
  const [scheme, setScheme] = useState<"http" | "https">("http");
  const [listenAddress, setListenAddress] = useState("");
  const [port, setPort] = useState("");
  const [confirmAction, setConfirmAction] = useState<RuntimeAction>();

  useEffect(() => {
    if (!settings.data) return;
    setScheme(settings.data.scheme);
    setListenAddress(settings.data.listenAddress);
    setPort(String(settings.data.port));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: adminService.updateRuntimeSettings,
    onSuccess: async (updated) => {
      setScheme(updated.scheme);
      setListenAddress(updated.listenAddress);
      setPort(String(updated.port));
      showAdminToast(t("admin.feedback.runtimeSettingsSaved"));
      await queryClient.setQueryData(["admin-runtime-settings"], updated);
    },
  });
  const action = useMutation({
    mutationFn: (value: RuntimeAction) => value === "restart" ? adminService.restartPlatform() : adminService.shutdownPlatform(),
    onSuccess: (_response, value) => {
      setConfirmAction(undefined);
      showAdminToast(t(value === "restart" ? "admin.runtime.restartAccepted" : "admin.runtime.shutdownAccepted"));
      if (value === "restart" && current) {
        const target = runtimeAdminUrl(current, locale);
        window.setTimeout(() => window.location.assign(target), 15_000);
      }
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate({ scheme, listenAddress: listenAddress.trim(), port: Number(port) });
  };
  const current = settings.data;
  const changed = current ? scheme !== current.scheme || listenAddress.trim() !== current.listenAddress || Number(port) !== current.port : false;
  const busy = save.isPending || action.isPending;

  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    {settings.isPending && <div className="center-state compact" role="status" aria-busy="true">{t("common.loading")}</div>}
    {settings.isError && <div className="message error" role="alert">{localizedApiError(settings.error, t)}</div>}
    {current && <div className="runtime-grid">
      <section className="runtime-card">
        <div className="runtime-card-heading">
          <div><h2>{t("admin.runtime.networkTitle")}</h2><p>{t("admin.runtime.networkDescription")}</p></div>
          {current.restartRequired && <span className="status status-contacting">{t("admin.runtime.restartRequired")}</span>}
        </div>
        <form className="runtime-form" onSubmit={submit}>
          <label>
            <span>{t("admin.runtime.scheme")}</span>
            <select name="scheme" value={scheme} onChange={(event) => setScheme(event.target.value as "http" | "https")}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
            <small>{t("admin.runtime.schemeHint")}</small>
          </label>
          <label>
            <span>{t("admin.runtime.listenAddress")}</span>
            <input name="listenAddress" list="listen-addresses" value={listenAddress} onChange={(event) => setListenAddress(event.target.value)} maxLength={64} required autoComplete="off" spellCheck={false} />
            <datalist id="listen-addresses"><option value="127.0.0.1" /><option value="0.0.0.0" /><option value="localhost" /><option value="::1" /><option value="::" /></datalist>
            <small>{t("admin.runtime.listenAddressHint")}</small>
          </label>
          <label>
            <span>{t("admin.runtime.port")}</span>
            <input name="port" type="number" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} min={1} max={65535} required />
            <small>{t("admin.runtime.portHint")}</small>
          </label>
          <div className="runtime-current">
            <span>{t("admin.runtime.activeEndpoint")}</span>
            <strong translate="no">{endpoint(current.activeScheme, current.activeListenAddress, current.activePort)}</strong>
            <small>{t("admin.runtime.pendingEndpoint")}: <span translate="no">{endpoint(current.scheme, current.listenAddress, current.port)}</span></small>
          </div>
          {save.isError && <div className="message error runtime-wide" role="alert">{localizedApiError(save.error, t)}</div>}
          <div className="runtime-actions runtime-wide">
            <button className="primary" disabled={!changed || busy}>{t(save.isPending ? "admin.runtime.saving" : "admin.runtime.save")}</button>
          </div>
        </form>
      </section>

      <section className="runtime-card runtime-control-card">
        <div className="runtime-card-heading"><div><h2>{t("admin.runtime.controlTitle")}</h2><p>{t("admin.runtime.controlDescription")}</p></div></div>
        <div className="runtime-control-list">
          <div>
            <div><strong>{t("admin.runtime.restart")}</strong><small>{t("admin.runtime.restartHint")}</small></div>
            <button type="button" disabled={!current.canRestart || busy || changed} onClick={() => setConfirmAction("restart")}>{t("admin.runtime.restart")}</button>
          </div>
          <div className="danger-zone">
            <div><strong>{t("admin.runtime.shutdown")}</strong><small>{t("admin.runtime.shutdownHint")}</small></div>
            <button className="danger" type="button" disabled={!current.canShutdown || busy} onClick={() => setConfirmAction("shutdown")}>{t("admin.runtime.shutdown")}</button>
          </div>
        </div>
        {changed && <p className="runtime-inline-note">{t("admin.runtime.saveBeforeRestart")}</p>}
        {!current.canRestart && <p className="runtime-inline-note">{t("admin.runtime.restartUnavailable")}</p>}
        {action.isError && <div className="message error" role="alert">{localizedApiError(action.error, t)}</div>}
      </section>
    </div>}
    {confirmAction && <ModalFrame labelledBy="runtime-confirm-title" busy={action.isPending} onClose={() => setConfirmAction(undefined)}>
      <div className="modal-title"><h2 id="runtime-confirm-title">{t(`admin.runtime.${confirmAction}ConfirmTitle`)}</h2><button type="button" aria-label={t("common.close")} disabled={action.isPending} onClick={() => setConfirmAction(undefined)}>×</button></div>
      <p>{t(`admin.runtime.${confirmAction}ConfirmBody`)}</p>
      <div className="modal-actions">
        <button type="button" disabled={action.isPending} onClick={() => setConfirmAction(undefined)}>{t("common.cancel")}</button>
        <button className={confirmAction === "shutdown" ? "danger" : "primary"} type="button" disabled={action.isPending} onClick={() => action.mutate(confirmAction)}>{t(action.isPending ? "admin.runtime.requesting" : `admin.runtime.confirm${confirmAction === "restart" ? "Restart" : "Shutdown"}`)}</button>
      </div>
    </ModalFrame>}
  </main>;
}
