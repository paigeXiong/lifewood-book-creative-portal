import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { BackupPolicy, BackupRecord, SupportedLocale } from "@lifewood/domain";
import { SettingsTabs } from "./SettingsTabs";
import { HelpPopover } from "./HelpPopover";
import { ModalFrame } from "./ModalFrame";
import "./backups.css";
import { RestoreHistoryDialog } from "./RestoreHistoryDialog";
import { RestoreDialog } from "./RestoreDialog";

export function BackupsPage({ locale, userId, allowed }: { locale: SupportedLocale; userId: string; allowed: boolean }) {
  const { t } = useTranslation(); const cache = useQueryClient();
  const [page, setPage] = useState(1), [source, setSource] = useState(""), [status, setStatus] = useState("");
  const [policy, setPolicy] = useState<BackupPolicy>(), [removing, setRemoving] = useState<BackupRecord>();
  const [verification,setVerification] = useState("");
  const [showHistory,setShowHistory] = useState(false);
  const [restoring, setRestoring] = useState<BackupRecord>();
  const recovery = useQuery({queryKey:["restore",userId],queryFn:adminService.restoreOverview,enabled:allowed,refetchInterval:2000,retry:false});
  const restoreBusy = !!recovery.data?.current && !["completed","failed","rolledBack","recoveryRequired"].includes(recovery.data.current.status);
  const [downloading, setDownloading] = useState<string>(), [downloadError, setDownloadError] = useState<unknown>();
  const abort = useRef<AbortController>(undefined); useEffect(() => () => abort.current?.abort(), []);
  const query = useQuery({queryKey:["backups",userId,page,source,status,verification],queryFn:()=>adminService.listBackups(page,source,status,verification),enabled:allowed,refetchInterval:3000});
  const refresh = () => cache.invalidateQueries({queryKey:["backups",userId]});
  const create = useMutation({mutationFn:adminService.createBackup,onSuccess:()=>{setPage(1);void refresh();}});
  const verify = useMutation({mutationFn:adminService.verifyBackup,onSuccess:()=>void refresh()});
  const save = useMutation({mutationFn:adminService.saveBackupPolicy,onSuccess:()=>{setPolicy(undefined);void refresh();}});
  const remove = useMutation({mutationFn:adminService.deleteBackup,onSuccess:()=>{setRemoving(undefined);void refresh();}});
  const data = query.data, busy = !!data?.current || create.isPending || verify.isPending || restoreBusy;
  const date = (value: string) => new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
  const size = (value?: number) => value == null ? "—" : new Intl.NumberFormat(locale,{style:"unit",unit:value>=1e9?"gigabyte":"megabyte",maximumFractionDigits:1}).format(value/(value>=1e9?1e9:1e6));
  async function download(item: BackupRecord) {
    const controller = new AbortController(); abort.current = controller; setDownloading(item.id); setDownloadError(undefined);
    try { const blob=await adminService.downloadBackup(item.id,controller.signal); if(controller.signal.aborted)return; const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`lifewood-backup-${item.createdAt.slice(0,19).replaceAll(":","-")}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }
    catch(error){if(!controller.signal.aborted)setDownloadError(error);} finally {if(!controller.signal.aborted)setDownloading(undefined);}
  }
  const error = query.error || create.error || verify.error || downloadError;
  return <main className="content config-content"><SettingsTabs locale={locale}/>
    {!allowed ? <p role="alert">{t("backups.forbidden")}</p> : <section className="backup-surface">
      <div className="backup-toolbar">
        <div className="backup-filters"><select aria-label={t("backups.source")} value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="">{t("backups.allSources")}</option><option value="manual">{t("backups.manual")}</option><option value="scheduled">{t("backups.scheduled")}</option><option value="safety">{t("backups.safety")}</option></select>
        <select aria-label={t("backups.statusLabel")} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t("backups.allStates")}</option><option value="completed">{t("backups.states.completed")}</option><option value="failed">{t("backups.states.failed")}</option></select><select aria-label={t("backups.check.label")} value={verification} onChange={e=>{setVerification(e.target.value);setPage(1);}}>{data?.verificationFilters?.map(option=><option key={option.value} value={option.value}>{t(option.messageKey)}</option>)}</select><HelpPopover label={t("backups.title")}>{t("backups.help")}</HelpPopover></div>
        <div className="backup-buttons"><button className="backup-icon" title={t("restore.history.title")} aria-label={t("restore.history.title")} onClick={()=>{setDownloadError(undefined);setShowHistory(true);}} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button><button disabled={!data||busy} onClick={()=>{save.reset();setPolicy(data!.schedule.policy);}}>{t("backups.policy")}</button><button className="primary" disabled={!data||busy} onClick={()=>create.mutate()}>{t("backups.create")}</button></div>
      </div>
      {data && <div className="backup-summary"><span>{t(data.schedule.policy.enabled?"backups.enabled":"backups.disabled")}</span>{data.schedule.nextRunAt&&<span>{t("backups.next",{time:date(data.schedule.nextRunAt)})}</span>}{data.current&&<strong role="status">{t(`backups.states.${data.current.status}`)}</strong>}<HelpPopover label={t("backups.policy")}>{t("backups.retentionHelp")}</HelpPopover></div>}
      {recovery.data?.current&&<div className="restore-progress" role="status"><strong>{t(`restore.states.${recovery.data.current.status}`)}</strong><HelpPopover label={t("restore.title")}>{t(recovery.data.current.errorCode?`restore.errors.${recovery.data.current.errorCode}`:"restore.progressHelp")}</HelpPopover>{["restarting","starting"].includes(recovery.data.current.status)&&<Link to={`/${locale}/login`}>{t("restore.login")}</Link>}</div>}
      {!recovery.data?.available&&recovery.data&&<div className="backup-summary">{t(`restore.${recovery.data.unavailableReason || "unavailable"}`)}<HelpPopover label={t("restore.title")}>{t(recovery.data.unavailableReason==="listenerChanges"?"restore.listenerHelp":"restore.offlineHelp")}</HelpPopover></div>}
      {restoreBusy&&recovery.error&&<p role="status">{t("restore.reconnecting")} <Link to={`/${locale}/login`}>{t("restore.login")}</Link></p>}
      {!!error&&<p className="message error" role="alert">{localizedApiError(error,t)}</p>}
      {data?.paused&&<p className="message" role="status">{t("backups.paused")}</p>}
      {query.isPending ? <p role="status">{t("common.loading")}</p> : !data?.items.length ? <p className="backup-empty">{t("backups.empty")}</p> : <div className="backup-table-wrap"><table className="backup-table"><thead><tr><th>{t("backups.createdAt")}</th><th>{t("backups.source")}</th><th>{t("backups.statusLabel")}</th><th>{t("backups.size")}</th><th>{t("backups.actions")}</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}>
        <td>{date(item.createdAt)}</td><td>{t(`backups.${item.source}`)}</td><td><span className={`backup-state ${item.verificationStatus || item.status}`}>{t(item.status==="completed" && item.verificationStatus ? `backups.check.${item.verificationStatus}` : `backups.states.${item.status}`)}</span>{item.status==="completed"&&<HelpPopover label={t("backups.check.label")}><p>{item.verifiedAt?t("backups.check.time",{time:date(item.verifiedAt)}):t("backups.check.noTime")}</p><p>{t(`backups.check.help.${item.verificationStatus || "unchecked"}`)}</p></HelpPopover>}{item.errorCode&&<HelpPopover label={t("backups.states.failed")}>{t(`backups.errors.${item.errorCode}`)}</HelpPopover>}</td><td>{size(item.size)}</td><td><div className="backup-row-actions"><button className="backup-icon" title={t("backups.check.action")} aria-label={t("backups.check.action")} disabled={busy||!!downloading||item.status!=="completed"} onClick={()=>verify.mutate(item.id)} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></svg></button><button className="backup-icon" title={t("restore.title")} aria-label={t("restore.title")} disabled={busy||!!downloading||item.status!=="completed"||!recovery.data?.available} onClick={()=>setRestoring(item)} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/></svg></button><button className="backup-icon" title={t("backups.download")} aria-label={t("backups.download")} disabled={item.status!=="completed"||!!downloading||data.paused} onClick={()=>void download(item)} data-icon-motion="press"><span data-icon-glyph aria-hidden="true">↓</span></button><button className="backup-icon" title={t("backups.delete")} aria-label={t("backups.delete")} disabled={busy||!!downloading} onClick={()=>{remove.reset();setRemoving(item);}} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button></div></td>
      </tr>)}</tbody></table></div>}
      {data&&<div className="backup-pagination"><span>{t("backups.total",{count:data.total})}</span><button disabled={page<=1} onClick={()=>setPage(page-1)} aria-label={t("backups.previous")}>‹</button><span>{page}</span><button disabled={page*data.pageSize>=data.total} onClick={()=>setPage(page+1)} aria-label={t("backups.nextPage")}>›</button></div>}
    </section>}
    {showHistory&&allowed&&<RestoreHistoryDialog locale={locale} userId={userId} busy={restoreBusy||!!data?.paused} downloading={!!downloading} downloadError={downloadError} onDownload={item=>void download(item)} onClose={()=>setShowHistory(false)}/>}
    {restoring&&<RestoreDialog item={restoring} locale={locale} userId={userId} onClose={()=>setRestoring(undefined)}/>}
    {policy&&<ModalFrame labelledBy="backup-policy-title" busy={save.isPending} onClose={()=>setPolicy(undefined)}><form onSubmit={e=>{e.preventDefault();save.mutate(policy);}}><div className="modal-title"><h2 id="backup-policy-title">{t("backups.policy")}</h2><button type="button" onClick={()=>setPolicy(undefined)} disabled={save.isPending} aria-label={t("common.close")}>×</button></div><div className="backup-policy-fields">
      <label className="backup-policy-toggle"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/>{t("backups.enable")}</label>
      <label>{t("backups.frequency")}<select value={policy.frequency} onChange={e=>setPolicy({...policy,frequency:e.target.value as "daily"|"weekly"})}><option value="daily">{t("backups.daily")}</option><option value="weekly">{t("backups.weekly")}</option></select></label>
      {policy.frequency==="weekly"&&<label>{t("backups.weekday")}<select value={policy.dayOfWeek} onChange={e=>setPolicy({...policy,dayOfWeek:Number(e.target.value)})}>{Array.from({length:7},(_,i)=><option key={i} value={i}>{new Intl.DateTimeFormat(locale,{weekday:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2026,0,4+i)))}</option>)}</select></label>}
      <label>{t("backups.hour")}<input type="number" min={0} max={23} required value={policy.hour} onChange={e=>setPolicy({...policy,hour:Number(e.target.value)})}/></label><label>{t("backups.timezone")}<select value={policy.timeZoneId} onChange={e=>setPolicy({...policy,timeZoneId:e.target.value as "Asia/Shanghai"|"UTC"})}><option value="Asia/Shanghai">{t("backups.shanghai")}</option><option value="UTC">UTC</option></select></label>
      <label>{t("backups.retainDays")}<input type="number" min={1} max={3650} required value={policy.retainDays} onChange={e=>setPolicy({...policy,retainDays:Number(e.target.value)})}/></label><label>{t("backups.retainCount")}<input type="number" min={1} max={500} required value={policy.retainCount} onChange={e=>setPolicy({...policy,retainCount:Number(e.target.value)})}/></label>
    </div>{save.error&&<p role="alert">{localizedApiError(save.error,t)}</p>}<div className="modal-actions"><HelpPopover label={t("backups.policy")}>{t("backups.retentionHelp")}</HelpPopover><button type="button" onClick={()=>setPolicy(undefined)} disabled={save.isPending}>{t("common.cancel")}</button><button className="primary" disabled={save.isPending}>{t("common.save")}</button></div></form></ModalFrame>}
    {removing&&<ModalFrame labelledBy="backup-delete-title" busy={remove.isPending} onClose={()=>setRemoving(undefined)}><h2 id="backup-delete-title">{t("backups.delete")}</h2><p>{t("backups.deleteConfirm",{time:date(removing.createdAt)})}</p>{remove.error&&<p role="alert">{localizedApiError(remove.error,t)}</p>}<div className="modal-actions"><button disabled={remove.isPending} onClick={()=>setRemoving(undefined)}>{t("common.cancel")}</button><button className="danger" disabled={remove.isPending} onClick={()=>remove.mutate(removing.id)}>{t("backups.delete")}</button></div></ModalFrame>}
  </main>;
}
