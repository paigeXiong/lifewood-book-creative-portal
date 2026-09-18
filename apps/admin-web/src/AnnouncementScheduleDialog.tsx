import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { announcementService, localizedApiError } from "@lifewood/api-client";
import type { AnnouncementDocument, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { UnsavedFormModal } from "./UnsavedFormModal";
import { HelpPopover } from "./HelpPopover";
export function AnnouncementScheduleDialog({item,locale,onClose,onSaved}:{item:AnnouncementDocument;locale:SupportedLocale;onClose:()=>void;onSaved:()=>void}) {
 const {t}=useTranslation();const [time,setTime]=useState("");
 const save=useMutation({mutationFn:()=>announcementService.schedule(item.id,item.version,new Date(time).toISOString()),onSuccess:onSaved});
 const valid=!!time&&Number.isFinite(new Date(time).getTime())&&new Date(time).getTime()>Date.now();
 return <UnsavedFormModal labelledBy="schedule-title" busy={save.isPending} onClose={onClose}>{({markDirty,requestClose})=><form onChange={markDirty} onSubmit={event=>{event.preventDefault();if(valid&&!save.isPending)save.mutate();}}>
  <h2 id="schedule-title">{t("automation.schedule")}</h2><p>{item.content.title??(locale==="en-US"?item.content.titleEn:item.content.titleZh)}</p>
  <label>{t("automation.runAt")}<input required type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label>
  <HelpPopover label={t("automation.runAt")}>{t("automation.scheduleHelp",{zone:Intl.DateTimeFormat().resolvedOptions().timeZone})}</HelpPopover>
  {save.error&&<p role="alert">{localizedApiError(save.error,t)}</p>}
  <div className="modal-actions"><button type="button" disabled={save.isPending} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={!valid||save.isPending}>{t(save.isPending?"common.loading":"automation.schedule")}</button></div>
 </form>}</UnsavedFormModal>;
}
