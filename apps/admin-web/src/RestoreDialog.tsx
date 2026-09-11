import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { BackupRecord, SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { HelpPopover } from "./HelpPopover";

export function RestoreDialog({ item, locale, userId, onClose }: { item: BackupRecord; locale: SupportedLocale; userId: string; onClose: () => void }) {
  const {t}=useTranslation();const cache=useQueryClient();const [confirmation,setConfirmation]=useState("");
  const preview=useQuery({queryKey:["restore-preflight",userId,item.id],queryFn:({signal})=>adminService.preflightRestore(item.id,signal),staleTime:0,refetchOnWindowFocus:false,retry:false,gcTime:0});
  const restore=useMutation({mutationFn:()=>adminService.restoreBackup(preview.data!.token,confirmation),onSuccess:()=>{void cache.invalidateQueries({queryKey:["restore",userId]});void cache.invalidateQueries({queryKey:["backups",userId]});onClose();}});
  const time=new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.createdAt));
  return <ModalFrame labelledBy="restore-title" busy={restore.isPending} onClose={onClose} className="restore-dialog"><form onSubmit={e=>{e.preventDefault();if(preview.data&&confirmation==="RESTORE")restore.mutate();}}>
    <div className="modal-title"><h2 id="restore-title">{t("restore.title")}</h2><button type="button" aria-label={t("common.close")} disabled={restore.isPending} onClick={onClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
    <p>{t("restore.target",{time})}</p>
    {preview.isPending&&<p role="status">{t("restore.checking")}</p>}
    {preview.data&&<><div className="restore-result"><strong>{t("restore.verified")}</strong><span>{t("restore.files",{count:preview.data.fileCount})}</span><HelpPopover label={t("restore.verified")}>{t("restore.checkHelp")}</HelpPopover></div>
      <p className="restore-warning">{t("restore.warning")}</p>
      <label className="restore-confirm-label">{t("restore.confirmLabel")}<input autoComplete="off" spellCheck={false} value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={restore.isPending} placeholder="RESTORE"/></label></>}
    {(preview.error||restore.error)&&<p role="alert">{localizedApiError(preview.error||restore.error,t)}</p>}
    <div className="modal-actions"><button type="button" disabled={restore.isPending} onClick={onClose}>{t("common.cancel")}</button><button className="danger" disabled={!preview.data||confirmation!=="RESTORE"||restore.isPending}>{t(restore.isPending?"restore.submitting":"restore.execute")}</button></div>
  </form></ModalFrame>;
}
