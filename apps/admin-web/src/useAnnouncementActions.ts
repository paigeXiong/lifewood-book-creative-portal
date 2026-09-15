import { useEffect, useRef, useState } from "react";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { ApiError, announcementService, captureAccountGuard } from "@lifewood/api-client";
import type { AnnouncementDocument, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { useConfirm } from "./useConfirm";
import { showAdminToast } from "./Toast";

type Action = "publish" | "withdraw" | "delete";
type Failure = { title: string; action: Action; cause: unknown; hint: string };
export function useAnnouncementActions(userId: string, locale: SupportedLocale, refreshList: () => Promise<unknown>) {
  const { t } = useTranslation(), confirm = useConfirm();
  const client=useQueryClient();
  const mutationKey=["admin-announcement-action",userId];
  const pending=useMutationState({filters:{mutationKey,status:"pending"},select:()=>true});
  const inFlight=()=>client.getMutationCache().findAll({mutationKey,status:"pending"}).length>0;
  const lifetime = useRef<object | null>(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<Failure>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshRef = useRef(refreshList); refreshRef.current = refreshList;
  useEffect(() => {
    const token = {}; lifetime.current = token; lock.current = false;
    setBusy(false); setFailure(undefined); setRefreshFailed(false);
    return () => { lifetime.current = null; };
  }, [userId, locale]);
  const refresh = async () => {
    if (lock.current || inFlight() || !lifetime.current) return;
    const token = lifetime.current; lock.current = true; setBusy(true);
    try {
      await refreshRef.current();
      if(lifetime.current===token){setRefreshFailed(false);setFailure(undefined);}
    } catch { if(lifetime.current===token)setRefreshFailed(true); }
    finally { if(lifetime.current===token){lock.current=false;setBusy(false);} }
  };
  const operation=useMutation({mutationKey,mutationFn:async ({d,action,token,guard}:{d:AnnouncementDocument;action:Action;token:object;guard:()=>void}) => {
    const valid=()=>lifetime.current===token;
    const title=d.content.title ?? (locale==="en-US"?d.content.titleEn:d.content.titleZh) ?? "";
    lock.current=true;setBusy(true);setFailure(undefined);
    let requested=false,submitted=false;
    try {
      if(!valid())return;
      guard();
      let prompt=action==="delete"?t("announcements.deleteConfirm",{title}):`${title}\n\n${t("announcements.withdrawConfirm")}`;
      if(action==="publish") {
        requested=true;
        const result=await announcementService.preview(d.id,d.version);
        if(!valid())return;guard();
        const audience=result.count==null?t("announcements.publicEstimate"):t("announcements.estimate",{count:result.count});
        prompt=`${title}\n\n${audience}\n${t("announcements.estimateHint")}\n\n${t("announcements.publishConfirm")}`;
      }
      if(!await confirm(prompt,action!=="publish")||!valid())return;
      guard();requested=true;submitted=true;
      if(action==="delete")await announcementService.deleteDraft(d.id,d.version);
      else await announcementService.transition(d.id,d.version,action);
      if(!valid())return;guard();
      showAdminToast(t(`announcements.actionSuccess.${action}`,{title}));
    } catch(cause) {
      if(valid()) {
        const code=cause instanceof ApiError?cause.details.code:"";
        const hint=code==="announcement.conflict"?"actionConflict":code==="announcement.missing"?"actionMissing":submitted && (!(cause instanceof ApiError)||cause.details.retryable)?"actionUnknown":"actionNotCompleted";
        setFailure({title,action,cause,hint});
      }
    } finally {
      if(requested)try {guard();await refreshRef.current();if(valid())setRefreshFailed(false);}catch{if(valid())setRefreshFailed(true);}
      if(valid()){lock.current=false;setBusy(false);}
    }
  }});
  const run=(d:AnnouncementDocument,action:Action)=>{
    if(lock.current||inFlight()||refreshFailed||!lifetime.current)return;
    lock.current=true;setBusy(true);
    operation.mutate({d,action,token:lifetime.current,guard:captureAccountGuard()});
  };
  return {busy:busy||pending.length>0,failure,refreshFailed,run,refresh};
}
