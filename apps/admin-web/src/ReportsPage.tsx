import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link,useSearchParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import type {SupportedLocale} from "@lifewood/domain";
import {productivityService,localizedApiError} from "@lifewood/api-client";
import "./productivity.css";
function localDay(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
export function ReportsPage({locale}:{locale:SupportedLocale}){
 const {t}=useTranslation(),[params,setParams]=useSearchParams();
 const now=new Date(),start=new Date();start.setDate(start.getDate()-29);
 const filters={from:params.get("from")||localDay(start),to:params.get("to")||localDay(now),organization:params.get("organization")||"",assignee:params.get("assignee")||"",offset:-now.getTimezoneOffset()};
 const [page,setPage]=useState(1);
 const query=useQuery({queryKey:["admin-reports",filters],queryFn:()=>productivityService.report(filters)});
 const data=query.data?.days??[],metrics=["submitted","delivered","overdue"] as const,maximum=Math.max(1,...data.flatMap(day=>metrics.map(key=>day[key])));
 const exportCsv=()=>{if(!query.data)return;const rows=[[t("productivity.date"),...metrics.map(key=>t("productivity.metrics."+key))],...data.map(day=>[day.date,...metrics.map(key=>day[key])])];const blob=new Blob(["\uFEFF"+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`report-${filters.from}-${filters.to}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <main className="content reports-page"><div className="reports-toolbar"><Link to={`/${locale}/workbench`}>{t("operations.workbench")}</Link><button disabled={!query.data||query.isFetching} onClick={exportCsv}>{t("productivity.exportCsv")}</button></div>
  <form className="reports-filters" key={params.toString()} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);setPage(1);setParams(new URLSearchParams(Object.fromEntries([...form].map(([key,value])=>[key,String(value)]))));}}>
   <label>{t("productivity.from")}<input name="from" type="date" required defaultValue={filters.from}/></label><label>{t("productivity.to")}<input name="to" type="date" required defaultValue={filters.to}/></label><label>{t("profile.organization")}<input name="organization" maxLength={200} defaultValue={filters.organization} placeholder={t("productivity.organizationSearch")}/></label><label>{t("admin.projects.assignee")}<input name="assignee" maxLength={200} defaultValue={filters.assignee} placeholder={t("productivity.assigneeSearch")}/></label><button>{t("common.search")}</button>
  </form>
  {query.isPending?<p role="status">{t("common.loading")}</p>:query.error?<p role="alert">{localizedApiError(query.error,t)}<button onClick={()=>void query.refetch()}>{t("common.retry")}</button></p>:<>
   <div className="reports-metrics">{metrics.map(key=><section key={key}><span>{t("productivity.metrics."+key)}</span><strong>{data.reduce((sum,day)=>sum+day[key],0)}</strong></section>)}</div>
   <details className="reports-note"><summary>{t("productivity.metricScope")}</summary><p>{t("productivity.reportScope")}</p></details>
   <div className="reports-chart" role="img" aria-label={t("productivity.trend")}>{data.every(day=>metrics.every(key=>day[key]===0))&&<span className="reports-empty">{t("productivity.noActivity")}</span>}<svg viewBox="0 0 900 180" preserveAspectRatio="none" aria-hidden="true">{data.map((day,index)=>metrics.map((key,metric)=><rect key={day.date+key} className={`metric-${key}`} x={index*900/data.length+metric*250/data.length} y={175-day[key]/maximum*165} width={Math.max(.3,200/data.length)} height={day[key]/maximum*165}/>))}</svg></div><div className="reports-axis"><span>{filters.from}</span><span>{filters.to}</span></div>
   <div className="reports-legend">{metrics.map(key=><span key={key}><i className={`metric-${key}`}/>{t("productivity.metrics."+key)}</span>)}</div>
   <table><thead><tr><th>{t("productivity.date")}</th>{metrics.map(key=><th key={key}>{t("productivity.metrics."+key)}</th>)}</tr></thead><tbody>{data.slice((page-1)*20,page*20).map(day=><tr key={day.date}><td data-label={t("productivity.date")}>{day.date}</td>{metrics.map(key=><td key={key} data-label={t("productivity.metrics."+key)}>{day[key]}</td>)}</tr>)}</tbody></table><div className="operations-pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>{t("operations.previous")}</button><span>{t("operations.page",{page,pages:Math.max(1,Math.ceil(data.length/20))})}</span><button disabled={page*20>=data.length} onClick={()=>setPage(page+1)}>{t("operations.next")}</button></div>
  </>}
 </main>;
}
