import { useEffect, useState } from "react";
import { useExportDownload } from "./useExportDownload";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AuditEvent, SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import "./audit-tools.css";

export function auditDayBoundary(
  value: string,
  endExclusive: boolean,
): string | undefined {
  if (!value) return undefined;
  const instant = new Date(`${value}T00:00:00.000`);
  if (endExclusive) instant.setDate(instant.getDate() + 1);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

export function AuditPage({locale,userId}:{locale:SupportedLocale;userId:string}) {
 const {t}=useTranslation(); const [params,setParams]=useSearchParams();
 const search=params.get("q")??"",actionId=params.get("action")??"",from=params.get("from")??"",to=params.get("to")??"";
 const raw=Number(params.get("page")); const page=Number.isSafeInteger(raw)&&raw>0?raw:1;
 const [input,setInput]=useState(search),[detail,setDetail]=useState<AuditEvent>();
 const downloadState=useExportDownload(JSON.stringify([userId,locale,search,actionId,from,to]));
 const {pending:exporting,error:exportError}=downloadState;
 useEffect(()=>{setInput(search);setDetail(undefined);},[search,actionId,from,to,page]);
 const filters={search,actionId,from:auditDayBoundary(from,false)??"",to:auditDayBoundary(to,true)??""};
 const actions=useQuery({queryKey:["admin-audit-actions",locale],queryFn:()=>adminService.listAuditActions(locale)});
 const events=useQuery({queryKey:["admin-audit-events",userId,filters,page],queryFn:()=>adminService.listAuditEvents({...filters,page,pageSize:30})});
 const label=(event:AuditEvent)=>(locale==="zh-CN"?event.context?.labelZh:event.context?.labelEn)||t("auditTools.unavailable");
 const action=(event:AuditEvent)=>actions.data?.find(x=>x.id===event.actionId)?.label??t("auditTools.otherAction");
 const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
 const update=(key:string,value:string)=>{const next=new URLSearchParams(params);value?next.set(key,value):next.delete(key);if(key!=="page")next.delete("page");setParams(next);};
 const pages=Math.max(1,Math.ceil((events.data?.total??0)/30));
 const download=()=>downloadState.run(signal=>adminService.exportAuditEvents(filters,locale,signal),"audit.csv");
 const value=(field:string,text?:string)=>text==null?t("auditTools.noValue"):["enabled","allowMute","allowsCustomValue","removed"].includes(field)?t(["1","True","true"].includes(text)?"auditTools.yes":"auditTools.no"):["level","audience"].includes(field)?t("auditTools.values."+text,{defaultValue:t("runtimeHealth.unknown")}):text;
 return <main className="content audit-content pagination-layout">
  <div className="page-toolbar audit-tools-toolbar">
   <form role="search" onSubmit={e=>{e.preventDefault();update("q",input.trim());}}><input type="search" value={input} onChange={e=>setInput(e.target.value)} aria-label={t("auditTools.search")} placeholder={t("auditTools.search")}/></form>
   <select aria-label={t("admin.audit.actionFilter")} value={actionId} onChange={e=>update("action",e.target.value)}><option value="">{t("admin.audit.allActions")}</option>{actions.data?.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select>
   <label>{t("admin.audit.from")}<input type="date" value={from} max={to||undefined} onChange={e=>update("from",e.target.value)}/></label><label>{t("admin.audit.to")}<input type="date" value={to} min={from||undefined} onChange={e=>update("to",e.target.value)}/></label>
   <button onClick={()=>void events.refetch()} disabled={events.isFetching}>{t("auditTools.refresh")}</button>
   <button onClick={()=>void download()} disabled={exporting||!events.data?.total||events.isFetching||events.isError}>{t(exporting?"common.loading":"auditTools.export")}</button>
   {exporting&&<button onClick={downloadState.cancel}>{t("common.cancel")}</button>}
  </div>
  {exportError!=null&&<p role="alert">{localizedApiError(exportError,t)}</p>}
  {events.isPending?<p role="status">{t("common.loading")}</p>:events.error?<p role="alert">{localizedApiError(events.error,t)}<button onClick={()=>void events.refetch()}>{t("common.retry")}</button></p>:<>
   <div className="pagination-scroll"><table className="audit-readable-table"><thead><tr>{["actor","action","target","time"].map(key=><th key={key}>{t("admin.audit."+key)}</th>)}<th><span className="sr-only">{t("auditTools.details")}</span></th></tr></thead><tbody>{events.data?.items.map(event=><tr key={event.id}>
    <td data-label={t("admin.audit.actor")}><strong>{event.actorName}</strong></td><td data-label={t("admin.audit.action")}>{action(event)}</td>
    <td data-label={t("admin.audit.target")}>{event.context?.path?<Link to={`/${locale}/${event.context.path}`}>{label(event)}</Link>:label(event)}</td>
    <td data-label={t("admin.audit.time")}><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time></td>
    <td><button className="audit-detail-button" aria-label={t("auditTools.detailsFor",{name:label(event)})} title={t("auditTools.details")} onClick={()=>setDetail(event)} data-icon-motion="press"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></button></td>
   </tr>)}</tbody></table>
   {!events.data?.items.length&&<div className="empty">{t("admin.audit.empty")}</div>}
   </div><nav className="pager pagination-footer"><button disabled={page<=1} onClick={()=>update("page",String(page-1))}>{t("common.previous")}</button><span>{t("common.pageOf",{page,pages})}</span><button disabled={page>=pages} onClick={()=>update("page",String(page+1))}>{t("common.next")}</button></nav>
  </>}
  {detail&&<ModalFrame labelledBy="audit-detail-title" className="audit-detail" onClose={()=>setDetail(undefined)}><header><h2 id="audit-detail-title">{action(detail)}</h2><button className="audit-detail-button" aria-label={t("common.close")} onClick={()=>setDetail(undefined)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></header>
   <dl><div><dt>{t("admin.audit.target")}</dt><dd>{label(detail)}</dd></div><div><dt>{t("admin.audit.actor")}</dt><dd>{detail.actorName}</dd></div><div><dt>{t("admin.audit.time")}</dt><dd>{date(detail.occurredAt)}</dd></div></dl>
   <p className="muted">{t("auditTools.sources."+(detail.context?.source??"unavailable"))}</p>
   {detail.context?.changes?<div className="audit-changes">{detail.context.changes.length?detail.context.changes.map(change=><section key={change.field}><strong>{t("auditTools.fields."+change.field)}</strong><div><span>{t("auditTools.before")}</span><p>{value(change.field,change.before)}</p></div><div><span>{t("auditTools.after")}</span><p>{value(change.field,change.after)}</p></div></section>):<p>{t("auditTools.unchanged")}</p>}</div>:<p className="muted">{t("auditTools.noChanges")}</p>}
   <details><summary>{t("auditTools.technical")}</summary><dl><div><dt>{t("admin.audit.target")}</dt><dd><code>{detail.targetId??"—"}</code></dd></div><div><dt>{t("admin.audit.request")}</dt><dd><code>{detail.traceId}</code></dd></div></dl></details>
  </ModalFrame>}
 </main>;
}
