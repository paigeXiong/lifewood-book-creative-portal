import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, announcementService, captureAccountGuard, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { HelpPopover } from "./HelpPopover";
import { useConfirm } from "./useConfirm";
import "@lifewood/ui/segmented-control.css";
import "./automation.css";

export function AutomationPage({locale,userId,canBackup}:{locale:SupportedLocale;userId:string;canBackup:boolean}) {
 const {t}=useTranslation(),cache=useQueryClient(),confirm=useConfirm();
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [params,setParams]=useSearchParams();
 const tab=params.get("tab")==="backups"&&canBackup?"backups":"announcements";
 const rawPage=Number(params.get("page")??1),page=Number.isSafeInteger(rawPage)&&rawPage>0?Math.min(rawPage,100000):1;
 const search=(params.get("q")??"").trim().slice(0,160);
 const status=["pending","completed","cancelled","failed"].includes(params.get("status")??"")?params.get("status")!:"";
 const change=(patch:Record<string,string>)=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete("page");for(const [key,value] of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key);}return next;});
 const setPage=(value:number)=>change({page:String(value)});
 const setTab=(value:string)=>change({tab:value==="backups"?value:""});
 const jobs=useQuery({queryKey:["announcement-jobs",userId,locale,page,search,status],queryFn:()=>announcementService.jobs(page,locale,search,status),refetchInterval:10000});
 const backups=useQuery({queryKey:["automation-backups",userId,page],queryFn:()=>adminService.listBackups(page,"",""),enabled:canBackup,refetchInterval:10000});
 const create=useMutation({mutationFn:adminService.createBackup,onSuccess:()=>{if(!alive.current)return;setTab("backups");void cache.invalidateQueries({queryKey:["automation-backups",userId]});}});
 const date=(v?:string|null)=>v?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
 const error=(tab==="backups"?backups.error:jobs.error)||create.error;
 useEffect(()=>{if(tab==="announcements"&&jobs.data&&jobs.data.page!==page)setParams(previous=>{const next=new URLSearchParams(previous);next.set("page",String(jobs.data.page));return next;},{replace:true});},[tab,jobs.data,page,setParams]);
 const total=tab==="backups"?backups.data?.total:jobs.data?.total;
 return <main className="content pagination-layout automation-page">
  <section className="automation-cards">
   <article><div className="automation-card-heading"><strong>{t("automation.announcements")}</strong><HelpPopover label={t("automation.announcements")}>{t("automation.announcementHelp")}</HelpPopover></div>
    <span>{jobs.data?t("automation.pendingCount",{count:jobs.data.pending}):"—"}</span><span>{t("automation.next",{time:date(jobs.data?.nextRunAt)})}</span>
    <Link className="button" to={`/${locale}/announcements?status=scheduled`}>{t("automation.viewScheduled")}</Link><Link className="button" to={`/${locale}/announcements?create=scheduled`}>{t("automation.createAnnouncement")}</Link><Link className="button" to={`/${locale}/announcements?status=draft`}>{t("automation.chooseDraft")}</Link>
   </article>
   {canBackup&&<article><div className="automation-card-heading"><strong>{t("automation.backups")}</strong><HelpPopover label={t("automation.backups")}>{t("automation.backupHelp")}</HelpPopover></div>
    <span>{backups.data?t(backups.data.paused?"automation.paused":backups.data.current?"automation.running":backups.data.schedule.policy.enabled?"automation.enabled":"automation.disabled"):"—"}</span><span>{t("automation.next",{time:date(backups.data?.schedule.nextRunAt)})}</span>
    <Link className="button" to={`/${locale}/settings/backups`}>{t("automation.configure")}</Link><button disabled={!backups.data||!!backups.data.current||backups.data.paused||create.isPending} onClick={()=>{const guard=captureAccountGuard();void confirm(t("automation.runBackupConfirm"),false).then(ok=>{if(ok&&alive.current){guard();create.mutate();}}).catch(()=>{});}}>{t("automation.runNow")}</button>
   </article>}
  </section>
  <section className="table-card pagination-layout pagination-surface">
   <div className="page-toolbar"><div className="lw-segmented" aria-label={t("automation.records")}><button aria-pressed={tab==="announcements"} onClick={()=>{setTab("announcements");}}>{t("automation.announcements")}</button>{canBackup&&<button aria-pressed={tab==="backups"} onClick={()=>{setTab("backups");}}>{t("automation.backups")}</button>}</div>{tab==="announcements"&&<form className="automation-filters" role="search" onSubmit={event=>{event.preventDefault();change({q:String(new FormData(event.currentTarget).get("q")??"").trim().slice(0,160)});}}>
    <input key={search} name="q" type="search" maxLength={160} defaultValue={search} aria-label={t("automation.search")} placeholder={t("automation.search")}/><button type="submit">{t("common.search")}</button>
    <select aria-label={t("automation.result")} value={status} onChange={event=>change({status:event.target.value})}><option value="">{t("automation.allStates")}</option>{["pending","completed","cancelled","failed"].map(value=><option key={value} value={value}>{t(`automation.states.${value}`)}</option>)}</select>
    {(search||status)&&<button type="button" onClick={()=>change({q:"",status:""})}>{t("automation.clear")}</button>}
   </form>}<button disabled={jobs.isFetching||backups.isFetching} onClick={()=>{void jobs.refetch();if(canBackup)void backups.refetch();}}>{t("common.refresh")}</button></div>
   {error&&<p className="message error" role="alert">{localizedApiError(error,t)}</p>}
   <div className="management-table-scroll"><table><thead><tr><th>{t("automation.task")}</th><th>{t("automation.runAt")}</th><th>{t("automation.finishedAt")}</th><th>{t("automation.result")}</th></tr></thead><tbody>
    {tab==="announcements"?jobs.data?.items.map(item=><tr key={item.id}><td><Link to={`/${locale}/announcements?notice=${encodeURIComponent(item.announcementId)}`}>{item.title||t("announcements.title")}</Link></td><td>{date(item.runAt)}</td><td>{date(item.finishedAt)}</td><td>{t(`automation.states.${item.status}`)}{item.errorCode&&<HelpPopover label={t("automation.result")}>{t("automation.publishFailed")}</HelpPopover>}</td></tr>):backups.data?.items.map(item=><tr key={item.id}><td>{t(`backups.${item.source}`)}</td><td>{date(item.createdAt)}</td><td>—</td><td>{t(`backups.states.${item.status}`)}{item.errorCode&&<HelpPopover label={t("automation.result")}>{t(`backups.errors.${item.errorCode}`)}</HelpPopover>}</td></tr>)}
   </tbody></table>{total===0&&<p className="empty">{t("automation.empty")}</p>}{(tab==="announcements"?jobs.isPending:backups.isPending)&&<p role="status">{t("common.loading")}</p>}</div>
   <nav className="pager pagination-footer"><span>{t("automation.total",{count:total??0})}</span><button disabled={page<=1} onClick={()=>setPage(page-1)}>{t("common.previous")}</button><span>{page}</span><button disabled={page*20>=(total??0)} onClick={()=>setPage(page+1)}>{t("common.next")}</button></nav>
  </section>
 </main>;
}
