import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { BackupRecord, SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";

export function RestoreHistoryDialog({locale,userId,busy,downloading,downloadError,onDownload,onClose}: {
  locale: SupportedLocale; userId: string; busy: boolean; downloading: boolean; downloadError?: unknown; onDownload: (item: BackupRecord)=>void; onClose: ()=>void;
}) {
  const {t}=useTranslation();const [page,setPage]=useState(1),[status,setStatus]=useState("");
  const query=useQuery({queryKey:["restore-history",userId,page,status,busy],queryFn:({signal})=>adminService.restoreHistory(page,status,signal),refetchInterval:busy?2000:false,retry:false});
  const data=query.data;
  const date=(value?:string)=>value?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):t("restore.history.unknownTime");
  return <ModalFrame labelledBy="restore-history-title" onClose={onClose} className="restore-history-dialog">
    <div className="modal-title"><h2 id="restore-history-title">{t("restore.history.title")}</h2><button onClick={onClose} aria-label={t("common.close")} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
    <div className="restore-history-toolbar"><select aria-label={t("restore.history.filter")} value={status} disabled={!data} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{data?.statuses.map(option=><option key={option.value} value={option.value}>{t(option.messageKey)}</option>)}</select><button className="backup-icon" disabled={query.isFetching} title={t("restore.history.refresh")} aria-label={t("restore.history.refresh")} onClick={()=>void query.refetch()} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></svg></button>{data?.incomplete&&<HelpPopover label={t("restore.history.incomplete")}>{t("restore.history.incompleteHelp")}</HelpPopover>}</div>
    {!!(query.error||downloadError)&&<p role="alert">{localizedApiError(query.error||downloadError,t)}</p>}
    <div className="restore-history-body">
      {query.isPending?<p className="backup-empty" role="status">{t("common.loading")}</p>:!data?.items.length?<p className="backup-empty">{t("restore.history.empty")}</p>:<table className="backup-table restore-history-table"><thead><tr><th>{t("restore.history.startedAt")}</th><th>{t("restore.history.actor")}</th><th>{t("restore.history.target")}</th><th>{t("restore.history.result")}</th><th>{t("backups.actions")}</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}>
        <td>{date(item.startedAt)}</td><td className="restore-history-actor" title={item.actorName}>{item.actorName||t("restore.history.unknownActor")}</td><td>{date(item.backupCreatedAt)}</td><td><span className={`backup-state ${item.status}`}>{t(`restore.states.${item.status}`,{defaultValue:t("restore.history.unknownStatus")})}</span></td>
        <td><div className="backup-row-actions"><HelpPopover label={t("restore.history.details")}><p>{t("restore.history.updatedAt",{time:date(item.updatedAt)})}</p><p>{item.errorCode?t(`restore.errors.${item.errorCode}`,{defaultValue:t("restore.preflightError")}):t("restore.history.recordHelp")}</p></HelpPopover><button className="backup-icon" aria-label={t("restore.history.downloadSafety")} title={t(item.safetyBackup?"restore.history.downloadSafety":"restore.history.noSafety")} disabled={!item.safetyBackup||busy||downloading} onClick={()=>item.safetyBackup&&onDownload(item.safetyBackup)} data-icon-motion="press"><svg data-icon-glyph aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/></svg></button></div></td>
      </tr>)}</tbody></table>}
    </div>
    {data&&<div className="backup-pagination"><span>{t("restore.history.total",{count:data.total})}</span><button disabled={data.page<=1||query.isFetching} onClick={()=>setPage(data.page-1)} aria-label={t("backups.previous")} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>‹</span></button><span>{data.page}</span><button disabled={data.page*data.pageSize>=data.total||query.isFetching} onClick={()=>setPage(data.page+1)} aria-label={t("backups.nextPage")} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>›</span></button></div>}
  </ModalFrame>;
}
