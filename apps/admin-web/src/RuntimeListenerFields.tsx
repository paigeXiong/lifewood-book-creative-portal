import { useTranslation } from "react-i18next";
import type { WebListenerSettings } from "@lifewood/domain";
import { HelpPopover } from "./HelpPopover";

export function RuntimeListenerFields({ name, value, sharedValue, activeUrl, pendingUrl, external, onChange }: {
  name: "customer" | "admin";
  value: WebListenerSettings;
  sharedValue: Pick<WebListenerSettings, "scheme" | "listenAddress" | "port">;
  activeUrl: string;
  pendingUrl?: string;
  external: boolean;
  onChange: (value: WebListenerSettings) => void;
}) {
  const { t } = useTranslation();
  const display = value.shared ? sharedValue : value;
  const id = `runtime-${name}`;
  const update = (patch: Partial<WebListenerSettings>) => onChange({ ...value, ...patch });
  return <fieldset className="runtime-listener runtime-wide">
    <legend><span>{t(`runtimeListeners.${name}`)}</span><HelpPopover label={t(`runtimeListeners.${name}`)}>{t(external ? "runtimeListeners.externalHelp" : "runtimeListeners.hostedHelp")}</HelpPopover></legend>
    {!external && <label className="runtime-shared"><input type="checkbox" checked={value.shared} onChange={event => update({ shared: event.target.checked })} />{t("runtimeListeners.shared")}</label>}
    <div className="runtime-listener-fields">
      <div className="runtime-field">
        <div className="runtime-field-heading"><label htmlFor={`${id}-scheme`}>{t("admin.runtime.scheme")}</label><HelpPopover label={t("admin.runtime.scheme")}>{t("runtimeListeners.httpsHelp")}</HelpPopover></div>
        <select id={`${id}-scheme`} value={display.scheme} disabled={value.shared} onChange={event => update({ scheme: event.target.value as "http" | "https" })}><option value="http">HTTP</option><option value="https">HTTPS</option></select>
      </div>
      <div className="runtime-field">
        <div className="runtime-field-heading"><label htmlFor={`${id}-address`}>{t("admin.runtime.listenAddress")}</label><HelpPopover label={t("admin.runtime.listenAddress")}>{t("admin.runtime.listenAddressHint")}</HelpPopover></div>
        <input id={`${id}-address`} list="listen-addresses" value={display.listenAddress} disabled={value.shared} required maxLength={64} autoComplete="off" spellCheck={false} onChange={event => update({ listenAddress: event.target.value })} />
      </div>
      <div className="runtime-field">
        <div className="runtime-field-heading"><label htmlFor={`${id}-port`}>{t("runtimeListeners.port")}</label><HelpPopover label={t("runtimeListeners.port")}>{t("runtimeListeners.portHelp")}</HelpPopover></div>
        <input id={`${id}-port`} type="number" inputMode="numeric" value={display.port || ""} disabled={value.shared} min={1} max={65535} required onChange={event => update({ port: Number(event.target.value) })} />
      </div>
    </div>
    <div className="runtime-current"><span>{t("runtimeListeners.active")}</span><strong translate="no">{activeUrl}</strong>{pendingUrl && pendingUrl !== activeUrl && <small>{t("runtimeListeners.pending")}: <span translate="no">{pendingUrl}</span></small>}</div>
  </fieldset>;
}
