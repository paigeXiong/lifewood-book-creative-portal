import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { localizedApiError, mailSettingsService } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";

export function MailTemplatePreview({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>{t("mailPreview.title")}</button>
    {open && <PreviewDialog locale={locale} onClose={() => setOpen(false)} />}</>;
}

function PreviewDialog({ locale, onClose }: { locale: SupportedLocale; onClose: () => void }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState(locale);
  const [kind, setKind] = useState("verify");
  const [format, setFormat] = useState("html");
  const query = useQuery({ queryKey: ["admin-mail-templates", language], queryFn: ({ signal }) => mailSettingsService.templates(language, signal), retry: false, gcTime: 0 });
  const selected = query.data?.find(item => item.kind === kind);
  const document = selected?.body.html.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">");
  return <ModalFrame labelledBy="mail-preview-title" className="mail-preview" onClose={onClose}>
    <header className="mail-preview-heading"><h2 id="mail-preview-title">{t("mailPreview.title")}</h2><HelpPopover label={t("mailPreview.title")}>{t("mailPreview.help")}</HelpPopover><button className="mail-preview-close" onClick={onClose}>{t("common.close")}</button></header>
    <div className="mail-preview-controls">
      <label>{t("mailPreview.kind")}<select value={kind} onChange={e => setKind(e.target.value)}>{(query.data ?? []).map(item => <option key={item.kind} value={item.kind}>{item.subject}</option>)}</select></label>
      <label>{t("mailPreview.language")}<select value={language} onChange={e => setLanguage(e.target.value as SupportedLocale)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
      <label>{t("mailPreview.format")}<select value={format} onChange={e => setFormat(e.target.value)}><option value="html">{t("mailPreview.html")}</option><option value="text">{t("mailPreview.text")}</option></select></label>
    </div>
    {query.isPending ? <p role="status">{t("common.loading")}</p> : query.isError ? <p role="alert">{localizedApiError(query.error, t)} <button onClick={() => void query.refetch()} disabled={query.isFetching}>{t("common.retry")}</button></p> : selected && <>
      <p className="mail-preview-subject">{t("mailPreview.subject")}：{selected.subject}</p>
      {format === "html" ? <FormattedPreview document={document!} title={t("mailPreview.title")} /> : <pre lang={language}>{selected.body.text}</pre>}
    </>}
  </ModalFrame>;
}

function FormattedPreview({ document, title }: { document: string; title: string }) {
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(560);
  useEffect(() => () => observer.current?.disconnect(), []);
  return <div className="mail-preview-scroll" role="region" aria-label={title} tabIndex={0}>
    <iframe title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={document} style={{ height }} onLoad={event => {
      observer.current?.disconnect();
      const body = event.currentTarget.contentDocument?.body;
      if (!body) return;
      // The parent owns scrolling and keyboard focus. Scripts, forms and network access stay disabled.
      const measure = () => setHeight(Math.ceil(body.getBoundingClientRect().height));
      measure();
      if (typeof ResizeObserver !== "undefined") { observer.current = new ResizeObserver(measure); observer.current.observe(body); }
    }} />
  </div>;
}
