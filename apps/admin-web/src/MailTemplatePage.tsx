import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, localizedApiError, mailSettingsService } from "@lifewood/api-client";
import type { MailTemplatePreview as Template } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { Link, useBlocker, useBeforeUnload, useSearchParams } from "react-router-dom";
import { SettingsTabs } from "./SettingsTabs";
import "./mail-status.css";
import { HelpPopover } from "./HelpPopover";

export function MailTemplatePage({ locale, allowed }: { locale: SupportedLocale; allowed: boolean }) {
  const { t } = useTranslation();
  return <main className="content config-content mail-template-content">
    <SettingsTabs locale={locale} />
    {allowed ? <TemplateWorkspace locale={locale} /> : <p role="alert">{t("mailQueue.ownerOnly")}</p>}
  </main>;
}

function TemplateWorkspace({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const blocker = useBlocker(editing);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm(t("mailEditor.discard"))) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, t]);
  useBeforeUnload(event => { if (editing) { event.preventDefault(); event.returnValue = ""; } });
  const [params,setParams]=useSearchParams();
  const language = params.get("language")==="en-US"?"en-US":params.get("language")==="zh-CN"?"zh-CN":locale;
  const kind = params.get("kind") ?? "verify";
  const choose=(name:string,value:string)=>setParams(current=>{const next=new URLSearchParams(current);next.set(name,value);return next;});
  const [draftPreview,setDraftPreview]=useState<Template|null>(null);
  useEffect(()=>setDraftPreview(null),[kind,language]);
  const [format, setFormat] = useState("html");
  const query = useQuery({ queryKey: ["admin-mail-templates", language], queryFn: ({ signal }) => mailSettingsService.templates(language, signal), retry: false, gcTime: 0 });
  const denied = query.error instanceof ApiError && ["auth.forbidden", "auth.required", "auth.unauthorized"].includes(query.error.details.code);
  const selected = query.data?.find(item => item.kind === kind);
  const displayed = draftPreview ?? selected;
  const document = displayed?.body.html.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">");
  return <section className="panel mail-preview mail-template-page" aria-label={t("mailEditor.title")}>
    <div className="mail-template-page-heading"><Link to={`/${locale}/settings/mail`}>← {t("mailQueue.title")}</Link><HelpPopover label={t("mailEditor.title")}>{t("mailEditor.help")}</HelpPopover></div>
    <div className="mail-preview-controls">
      <label>{t("mailPreview.kind")}<select disabled={editing} value={kind} onChange={e => choose("kind",e.target.value)}>{(query.data ?? []).map(item => <option key={item.kind} value={item.kind}>{item.subject}</option>)}</select></label>
      <label>{t("mailPreview.language")}<select disabled={editing} value={language} onChange={e => choose("language",e.target.value)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
      <label>{t("mailPreview.format")}<select value={format} onChange={e => setFormat(e.target.value)}><option value="html">{t("mailPreview.html")}</option><option value="text">{t("mailPreview.text")}</option></select></label>
    </div>
    {query.isError && selected && !denied && <p role="alert">{t("recovery.refreshFailed")} <button onClick={() => void query.refetch()}>{t("common.retry")}</button></p>}
    {query.isPending ? <p role="status">{t("common.loading")}</p> : query.isError && (!selected || denied) ? <p role="alert">{localizedApiError(query.error, t)} <button onClick={() => void query.refetch()} disabled={query.isFetching}>{t("common.retry")}</button></p> : selected && <div className="mail-template-workspace">
      <TemplateEditor key={`${kind}:${language}`} selected={selected} language={language} onEditing={setEditing} onPreview={setDraftPreview} onSaved={async () => { await query.refetch(); setDraftPreview(null); }} />
      <div className="mail-template-result"><p className="mail-preview-subject">{t("mailPreview.subject")}：{displayed?.subject}{draftPreview && <small> · {t("mailEditor.unsavedPreview")}</small>}</p>
      {format === "html" ? <FormattedPreview document={document!} title={t("mailEditor.title")} /> : <pre lang={language}>{displayed?.body.text}</pre>}
      </div>
    </div>}
  </section>;
}

function TemplateEditor({selected,language,onSaved,onEditing,onPreview}:{selected:Template;language:SupportedLocale;onSaved:()=>Promise<void>;onEditing:(value:boolean)=>void;onPreview:(value:Template|null)=>void}) {
  const {t}=useTranslation();
  const [editing,updateEditing]=useState(false);
  const setEditing=(value:boolean)=>{updateEditing(value);if(!value)onPreview(null);};
  const [subject,setSubject]=useState(selected.subject);
  const [introduction,setIntroduction]=useState(selected.introduction);
  const [enabled,setEnabled]=useState(selected.enabled);
  const [revision,setRevision]=useState(selected.revision);
  const [baseline,setBaseline]=useState(selected);
  const dirty=editing&&(subject!==baseline.subject||introduction!==baseline.introduction||enabled!==baseline.enabled);
  useEffect(()=>onEditing(dirty),[dirty,onEditing]);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const preview=useMutation({mutationFn:()=>mailSettingsService.previewTemplate(selected.kind,language,{revision,subject,introduction,enabled}),onSuccess:value=>{if(mounted.current)onPreview(value);}});
  useEffect(()=>onPreview(null),[subject,introduction,enabled,onPreview]);
  const save=useMutation({mutationFn:(reset:boolean)=>mailSettingsService.saveTemplate(selected.kind,language,{revision,subject,introduction,enabled,reset}),onSuccess:async()=>{await onSaved();setEditing(false);}});
  const test=useMutation({mutationFn:()=>mailSettingsService.testTemplate(selected.kind,language,selected.revision)});
  return <div className="mail-template-editor">
    {preview.isError && <p role="alert">{localizedApiError(preview.error,t)}</p>}
    {test.isError && <p role="alert">{localizedApiError(test.error,t)}</p>}
    {test.isSuccess && <p role="status">{t("mailEditor.testSent")}</p>}
    {!editing ? <div className="mail-template-actions"><span>{t(selected.enabled?"mailEditor.enabled":"mailEditor.disabled")}</span><button type="button" onClick={()=>{setBaseline(selected);setRevision(selected.revision);setSubject(selected.subject);setIntroduction(selected.introduction);setEnabled(selected.enabled);save.reset();setEditing(true);}}>{t("mailEditor.edit")}</button><button type="button" disabled={test.isPending} onClick={()=>{if(window.confirm(t("mailEditor.testConfirm")))test.mutate();}}>{t("mailEditor.test")}</button></div> : <form onSubmit={e=>{e.preventDefault();save.mutate(false);}}>
      <label>{t("mailPreview.subject")}<input required maxLength={160} value={subject} disabled={save.isPending||preview.isPending} onChange={e=>setSubject(e.target.value)}/></label>
      <label>{t("mailEditor.body")}<textarea required maxLength={4000} rows={4} value={introduction} disabled={save.isPending||preview.isPending} onChange={e=>setIntroduction(e.target.value)}/></label>
      <div className="mail-template-actions">{selected.kind==="notice"?<label><input type="checkbox" checked={enabled} disabled={save.isPending||preview.isPending} onChange={e=>setEnabled(e.target.checked)}/>{t("mailEditor.enable")}</label>:<span>{t("mailEditor.required")}</span>}<HelpPopover label={t("mailEditor.title")}>{t("mailEditor.help")}</HelpPopover></div>
      {save.isError&&<p role="alert">{localizedApiError(save.error,t)}</p>}
      <div className="mail-template-actions"><button type="button" disabled={save.isPending||preview.isPending} onClick={()=>preview.mutate()}>{t("mailEditor.preview")}</button><button type="submit" disabled={save.isPending||preview.isPending}>{t("mailEditor.save")}</button><button type="button" disabled={save.isPending||preview.isPending} onClick={()=>{if(window.confirm(t("mailEditor.resetConfirm")))save.mutate(true);}}>{t("mailEditor.reset")}</button><button type="button" disabled={save.isPending||preview.isPending} onClick={()=>setEditing(false)}>{t("common.cancel")}</button></div>
    </form>}
  </div>;
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
