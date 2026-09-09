import {useEffect} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {adminService,localizedApiError} from "@lifewood/api-client";
import type {SupportedLocale,UserPresence,UserPresenceStats} from "@lifewood/domain";
import {NoticeModal} from "@lifewood/ui/notifications";
import "./user-activity.css";

// Discard a directory response started before the acknowledged heartbeat.
// Cancelling first also handles an initial query which has no cached data yet.
export function usePresenceDirectorySync() {
 const client=useQueryClient();
 useEffect(()=>{
  let disposed=false;
  const refresh=()=>{
   void Promise.all([client.cancelQueries({queryKey:["admin-users"]}),client.cancelQueries({queryKey:["admin-user-details"]})]).then(()=>{
    if(disposed)return;
    return Promise.all([client.invalidateQueries({queryKey:["admin-users"]}),client.invalidateQueries({queryKey:["admin-user-details"]})]);
   });
  };
  window.addEventListener("lw-presence-updated",refresh);
  return()=>{disposed=true;window.removeEventListener("lw-presence-updated",refresh);};
 },[client]);
}

export function PresenceBadge({presence}:{presence?:UserPresence}) {
 const {t}=useTranslation();
 return presence?<span className={`user-presence ${presence.status}`}><i aria-hidden="true"/>{t(`userActivity.${presence.status}`)}</span>:<span className="muted">{t("userActivity.noData")}</span>;
}
export function ActivityTime({value,locale}:{value?:string;locale:SupportedLocale}) {
 const {t}=useTranslation();
 return value?<time dateTime={value}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}</time>:<span className="muted">{t("userActivity.noData")}</span>;
}
export function UserActivityStats({statistics}:{statistics?:UserPresenceStats}) {
 const {t}=useTranslation();
 return <section className="user-activity-stats" aria-label={t("userActivity.summary")}>
  {(["online","todayActive","enabled","unassigned"] as const).map(key=><div key={key}><span>{t(`userActivity.${key==='online'?'onlineCount':key}`)}</span><strong>{statistics?.[key]??"—"}</strong></div>)}
 </section>;
}
export function UserActivityDetails({id,locale,onClose}:{id:string;locale:SupportedLocale;onClose:()=>void}) {
 const {t}=useTranslation();
 const query=useQuery({queryKey:["admin-user-details",id],queryFn:()=>adminService.userDetails(id),refetchInterval:15000});
 const data=query.data;
 return <NoticeModal title={t("userActivity.details")} onClose={onClose}>
  {query.isPending?<p role="status">{t("common.loading")}</p>:query.error?<p role="alert">{localizedApiError(query.error,t)} <button onClick={()=>void query.refetch()}>{t("common.retry")}</button></p>:data&&<div className="user-activity-details">
   <div className="user-detail-identity"><strong>{data.user.displayName}</strong><PresenceBadge presence={data.user.presence}/></div>
   <dl>
    <div><dt>{t("admin.users.organization")}</dt><dd>{data.user.organization?.name??t("admin.users.noOrganization")}</dd></div>
    <div><dt>{t("admin.users.role")}</dt><dd>{t(`admin.roles.${data.user.role}`)}</dd></div>
    <div><dt>{t("userActivity.lastActive")}</dt><dd><ActivityTime value={data.user.presence?.lastActiveAt} locale={locale}/></dd></div>
    <div><dt>{t("userActivity.lastLogin")}</dt><dd><ActivityTime value={data.user.presence?.lastLoginAt} locale={locale}/></dd></div>
    <div><dt>{t("admin.users.created")}</dt><dd><ActivityTime value={data.user.createdAt} locale={locale}/></dd></div>
    <div><dt>{t("userActivity.submittedProjects")}</dt><dd>{data.submittedProjects}</dd></div>
    <div><dt>{t("userActivity.pendingProjects")}</dt><dd>{data.pendingProjects}</dd></div>
   </dl>
  </div>}
 </NoticeModal>;
}
