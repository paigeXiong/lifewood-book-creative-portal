import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import "./audit-tools.css";
export function RuntimeHealthPanel({locale,userId}:{locale:SupportedLocale;userId:string}) {
 const {t}=useTranslation();
 const query=useQuery({queryKey:["admin-runtime-health",userId],queryFn:adminService.getRuntimeHealth,refetchInterval:30000});
 const data=query.data;
 const bytes=(value?:number)=>{if(value==null)return t("runtimeHealth.unknown");const scale=value>=1e9?1e9:value>=1e6?1e6:value>=1e3?1e3:1;const unit=scale===1e9?"gigabyte":scale===1e6?"megabyte":scale===1e3?"kilobyte":"byte";return new Intl.NumberFormat(locale,{style:"unit",unit,maximumFractionDigits:1}).format(value/scale);};
 const minutes=data?Math.max(0,Math.floor((Date.now()-new Date(data.startedAt).getTime())/60000)):0;
 const ratio=data?.usedBytes!=null?Math.round(data.usedBytes/data.quotaBytes*100):null;
 const bool=(value?:boolean)=>value==null?t("runtimeHealth.unknown"):t(value?"runtimeHealth.available":"runtimeHealth.unavailable");
 return <section className="runtime-health" aria-label={t("runtimeHealth.title")}>
  <header><strong>{t("runtimeHealth.title")}</strong><span>{data?.measuredAt?t("runtimeHealth.measured",{time:new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(data.measuredAt))}):t("runtimeHealth.measuring")}</span><button disabled={query.isFetching} onClick={()=>void query.refetch()}>{t("auditTools.refresh")}</button></header>
  {query.error?<p role="alert">{localizedApiError(query.error,t)}</p>:!data?<p role="status">{t("common.loading")}</p>:<>
   <div className="runtime-health-grid">
    <div className="runtime-storage"><div className="runtime-storage-ring" role="img" aria-label={t("runtimeHealth.quotaUse",{value:ratio??"—"})} style={{background:`conic-gradient(var(--brand, #19513e) ${Math.min(100,ratio??0)}%, #e9eeeb 0)`}}><strong>{ratio==null?"—":ratio+"%"}</strong></div><div><span>{t("runtimeHealth.storage")}</span><strong>{bytes(data.usedBytes)} / {bytes(data.quotaBytes)}</strong></div></div>
    <div><span>{t("runtimeHealth.database")}</span><strong className={data.databaseAvailable===false?"runtime-warning":""}>{bool(data.databaseAvailable)}</strong></div>
    <div><span>{t("runtimeHealth.free")}</span><strong className={data.freeBytes!=null&&data.freeBytes<1024**3?"runtime-warning":""}>{bytes(data.freeBytes)}</strong></div>
    <div><span>{t("runtimeHealth.uptime")}</span><strong title={new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(data.startedAt))}>{t("runtimeHealth.uptimeValue",{hours:Math.floor(minutes/60),minutes:minutes%60})}</strong></div>
   </div>
   <details><summary>{t("runtimeHealth.details")}</summary><dl className="runtime-health-details"><div><dt>{t("runtimeHealth.uploads")}</dt><dd>{bytes(data.uploadBytes)}</dd></div><div><dt>{t("runtimeHealth.deliveries")}</dt><dd>{bytes(data.deliveryBytes)}</dd></div><div><dt>{t("runtimeHealth.failed")}</dt><dd>{data.failedNotifications??t("runtimeHealth.unknown")}</dd></div><div><dt>{t("runtimeHealth.audit")}</dt><dd>{data.pendingAudit==null?t("runtimeHealth.unknown"):t(data.pendingAudit?"runtimeHealth.pending":"runtimeHealth.clear")}</dd></div></dl><p className="muted">{t("runtimeHealth.scope")}</p>{!data.storageComplete&&data.measuredAt&&<p role="status">{t("runtimeHealth.partial")}</p>}</details>
  </>}
 </section>;
}
