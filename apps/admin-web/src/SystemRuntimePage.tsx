import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { RuntimeSettings, SupportedLocale, WebListenerSettings } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";
import { RuntimeListenerFields } from "./RuntimeListenerFields";
import { RuntimeHealthPanel } from "./RuntimeHealthPanel";
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
  settings: Pick<RuntimeSettings, "scheme" | "listenAddress" | "port" | "admin" | "externalFrontends">,
  locale: SupportedLocale,
  currentHostname?: string,
) {
  const listener = settings.admin && !settings.admin.shared ? settings.admin : settings;
  return endpoint(listener.scheme, listener.listenAddress, listener.port, currentHostname) + (settings.externalFrontends ? "/" : "/admin/") + locale + "/settings/runtime";
}

export function SystemRuntimePage({ locale, userId }: { locale: SupportedLocale; userId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-runtime-settings"], queryFn: adminService.getRuntimeSettings });
  const [scheme, setScheme] = useState<"http" | "https">("http");
  const [listenAddress, setListenAddress] = useState("");
  const [port, setPort] = useState("");
  const [customer, setCustomer] = useState<WebListenerSettings>();
  const [admin, setAdmin] = useState<WebListenerSettings>();
  const [confirmAction, setConfirmAction] = useState<RuntimeAction>();

  useEffect(() => {
    if (!settings.data) return;
    setScheme(settings.data.scheme);
    setListenAddress(settings.data.listenAddress);
    setPort(String(settings.data.port));
    setCustomer(settings.data.customer);
    setAdmin(settings.data.admin);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: adminService.updateRuntimeSettings,
    onSuccess: async (updated) => {
      setScheme(updated.scheme);
      setListenAddress(updated.listenAddress);
      setPort(String(updated.port));
      setCustomer(updated.customer);
      setAdmin(updated.admin);
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
    save.mutate({ scheme, listenAddress: listenAddress.trim(), port: Number(port), customer, admin });
  };
  const current = settings.data;
  const changed = current ? scheme !== current.scheme || listenAddress.trim() !== current.listenAddress || Number(port) !== current.port || JSON.stringify(customer) !== JSON.stringify(current.customer) || JSON.stringify(admin) !== JSON.stringify(current.admin) : false;
  const busy = save.isPending || action.isPending;

  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    <RuntimeHealthPanel locale={locale} userId={userId} />
    {settings.isPending && <div className="center-state compact" role="status" aria-busy="true">{t("common.loading")}</div>}
    {settings.isError && <div className="message error" role="alert">{localizedApiError(settings.error, t)}</div>}
    {current && <div className="runtime-grid">
      <section className="runtime-card">
        <div className="runtime-card-heading">
          <div className="runtime-help-heading"><h2>{t("admin.runtime.networkTitle")}</h2><HelpPopover label={t("admin.runtime.networkTitle")}>{t(current.externalFrontends ? "runtimeListeners.externalHelp" : "runtimeListeners.hostedHelp")}</HelpPopover></div>
          {current.restartRequired && <span className="status status-contacting">{t("admin.runtime.restartRequired")}</span>}
        </div>
        <form className="runtime-form" onSubmit={submit}>
          <h3 className="runtime-listener-title runtime-wide">{t("runtimeListeners.backend")}</h3>
          <div className="runtime-field">
            <div className="runtime-field-heading"><label htmlFor="runtime-scheme">{t("admin.runtime.scheme")}</label><HelpPopover label={t("admin.runtime.scheme")}>{t("admin.runtime.schemeHint")}</HelpPopover></div>
            <select id="runtime-scheme" name="scheme" value={scheme} onChange={(event) => setScheme(event.target.value as "http" | "https")}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </div>
          <div className="runtime-field">
            <div className="runtime-field-heading"><label htmlFor="runtime-listen-address">{t("admin.runtime.listenAddress")}</label><HelpPopover label={t("admin.runtime.listenAddress")}>{t("admin.runtime.listenAddressHint")}</HelpPopover></div>
            <input id="runtime-listen-address" name="listenAddress" list="listen-addresses" value={listenAddress} onChange={(event) => setListenAddress(event.target.value)} maxLength={64} required autoComplete="off" spellCheck={false} />
            <datalist id="listen-addresses"><option value="127.0.0.1" /><option value="0.0.0.0" /><option value="localhost" /><option value="::1" /><option value="::" /></datalist>
          </div>
          <div className="runtime-field">
            <div className="runtime-field-heading"><label htmlFor="runtime-port">{t("admin.runtime.port")}</label><HelpPopover label={t("admin.runtime.port")}>{t("admin.runtime.portHint")}</HelpPopover></div>
            <input id="runtime-port" name="port" type="number" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} min={1} max={65535} required />
          </div>
          <div className="runtime-current">
            <span>{t("admin.runtime.activeEndpoint")}</span>
            <strong translate="no">{endpoint(current.activeScheme, current.activeListenAddress, current.activePort)}</strong>
            {current.restartRequired && <small>{t("admin.runtime.pendingEndpoint")}: <span translate="no">{endpoint(current.scheme, current.listenAddress, current.port)}</span></small>}
          </div>
          {(["customer", "admin"] as const).map(name => {
            const value = name === "customer" ? customer : admin;
            const active = name === "customer" ? current.activeCustomer : current.activeAdmin;
            if (!value || !active) return null;
            const pending = value.shared ? { scheme, listenAddress, port: Number(port) } : value;
            const suffix = name === "admin" && !current.externalFrontends ? "/admin" : "";
            return <RuntimeListenerFields key={name} name={name} value={value} sharedValue={{ scheme, listenAddress, port: Number(port) }} external={!!current.externalFrontends}
              activeUrl={endpoint(active.scheme, active.listenAddress, active.port) + suffix}
              pendingUrl={endpoint(pending.scheme, pending.listenAddress, pending.port) + suffix}
              onChange={name === "customer" ? setCustomer : setAdmin} />;
          })}
          {save.isError && <div className="message error runtime-wide" role="alert">{localizedApiError(save.error, t)}</div>}
          <div className="runtime-actions runtime-wide">
            <button className="primary" disabled={!changed || busy}>{t(save.isPending ? "admin.runtime.saving" : "admin.runtime.save")}</button>
          </div>
        </form>
      </section>

      <section className="runtime-card runtime-control-card">
        <div className="runtime-card-heading"><div className="runtime-help-heading"><h2>{t("admin.runtime.controlTitle")}</h2><HelpPopover label={t("admin.runtime.controlTitle")}>{t(current.externalFrontends ? "runtimeListeners.externalHelp" : "admin.runtime.controlDescription")}</HelpPopover></div></div>
        <div className="runtime-control-list">
          <div>
            <div className="runtime-help-heading"><strong>{t("admin.runtime.restart")}</strong><HelpPopover label={t("admin.runtime.restart")}>{t("admin.runtime.restartHint")}</HelpPopover></div>
            <button type="button" disabled={!current.canRestart || busy || changed} onClick={() => setConfirmAction("restart")}>{t("admin.runtime.restart")}</button>
          </div>
          <div className="danger-zone">
            <div className="runtime-help-heading"><strong>{t("admin.runtime.shutdown")}</strong><HelpPopover label={t("admin.runtime.shutdown")}>{t("admin.runtime.shutdownHint")}</HelpPopover></div>
            <button className="danger" type="button" disabled={!current.canShutdown || busy} onClick={() => setConfirmAction("shutdown")}>{t("admin.runtime.shutdown")}</button>
          </div>
        </div>
        {changed && <p className="runtime-inline-note">{t("admin.runtime.saveBeforeRestart")}</p>}
        {!current.canRestart && !current.externalFrontends && <p className="runtime-inline-note">{t(current.externalFrontends ? "runtimeListeners.externalRestart" : "admin.runtime.restartUnavailable")}</p>}
        {action.isError && <div className="message error" role="alert">{localizedApiError(action.error, t)}</div>}
      </section>
    </div>}
    {confirmAction && <ModalFrame labelledBy="runtime-confirm-title" busy={action.isPending} onClose={() => setConfirmAction(undefined)}>
      <div className="modal-title"><h2 id="runtime-confirm-title">{t(`admin.runtime.${confirmAction}ConfirmTitle`)}</h2><button type="button" aria-label={t("common.close")} disabled={action.isPending} onClick={() => setConfirmAction(undefined)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
      <p>{t(`admin.runtime.${confirmAction}ConfirmBody`)}</p>
      <div className="modal-actions">
        <button type="button" disabled={action.isPending} onClick={() => setConfirmAction(undefined)}>{t("common.cancel")}</button>
        <button className={confirmAction === "shutdown" ? "danger" : "primary"} type="button" disabled={action.isPending} onClick={() => action.mutate(confirmAction)}>{t(action.isPending ? "admin.runtime.requesting" : `admin.runtime.confirm${confirmAction === "restart" ? "Restart" : "Shutdown"}`)}</button>
      </div>
    </ModalFrame>}
  </main>;
}
