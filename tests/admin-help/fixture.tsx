import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { i18n } from "@lifewood/i18n";
import { useTranslation } from "react-i18next";
import "../../apps/admin-web/src/i18n";
import "@lifewood/ui/tokens.css";
import "../../apps/admin-web/src/styles.css";
import "../../apps/admin-web/src/surface-theme.css";
import { HelpPopover } from "../../apps/admin-web/src/HelpPopover";
import { ModalFrame } from "../../apps/admin-web/src/ModalFrame";

await i18n.changeLanguage(new URLSearchParams(location.search).get("locale") || "zh-CN");
function Fixture() {
  const { t } = useTranslation(), [modal, setModal] = useState(false), [submitted, setSubmitted] = useState(0);
  const first = <HelpPopover label={t("oidc.fields.publicOrigin")}>{t("oidc.publicOriginHint")}</HelpPopover>;
  return <main style={{ padding: 16 }}>
    <button id="modal-open" onClick={() => setModal(true)}>Open modal fixture</button>
    <button id="language" onClick={() => void i18n.changeLanguage(i18n.language === "en-US" ? "zh-CN" : "en-US")}>Language fixture</button>
    <output id="submitted">{submitted}</output>
    <form onSubmit={e => { e.preventDefault(); setSubmitted(count => count + 1); }}>
      <div id="scrollbox" style={{ height: 420, overflow: "auto", marginTop: 16 }}>
        <div style={{ height: 200 }} />
        <div id="first" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>{t("oidc.fields.publicOrigin")}{first}</div>
        <div id="second"><HelpPopover label={t("oidc.fields.adminOrigin")}>{t("oidc.adminOriginHint")}</HelpPopover></div>
        <button id="after" type="button">Next control fixture</button>
        <div style={{ height: 900 }} />
      </div>
    </form>
    {modal && <ModalFrame labelledBy="modal-title" onClose={() => setModal(false)}><h2 id="modal-title">Modal fixture</h2><div id="modal-help">{first}</div><input aria-label="Next modal field" /></ModalFrame>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
