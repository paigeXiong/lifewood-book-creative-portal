import {BatchEditor,readBatchDraft,type BatchDraft} from "./BatchEditor";
import {SavedViews} from "@lifewood/ui/saved-views";
import {useEffect, useState, type FormEvent} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link, useSearchParams, useLocation, useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {operationsService, optionService, localizedApiError} from "@lifewood/api-client";
import {localizedPath} from "@lifewood/i18n";
import type {SupportedLocale} from "@lifewood/domain";
import "./operations.css";

export function WorkbenchPage({locale,permissions,userId}: {locale: SupportedLocale;permissions:string[];userId:string}) {
  const {t}=useTranslation();
  const location=useLocation(),navigate=useNavigate();
  const restored=readBatchDraft(location.state);
  const [selected,setSelected]=useState<string[]>(restored?.ids??[]),[selecting,setSelecting]=useState(Boolean(restored));
  const [batch,setBatch]=useState<BatchDraft|undefined>(restored);
  const toggle=(id:string)=>setSelected(ids=>ids.includes(id)?ids.filter(value=>value!==id):ids.length<50?[...ids,id]:ids);
  const closeBatch=()=>{setBatch(undefined);setSelected([]);setSelecting(false);navigate(location.pathname+location.search,{replace:true,state:null});};
  const [params,setParams]=useSearchParams();
  const search=params.get("q")??"", queue=params.get("queue")??"active", mine=params.get("mine")==="true";
  const rawPage=Number(params.get("page")), page=Number.isSafeInteger(rawPage)&&rawPage>0?rawPage:1;
  const [input,setInput]=useState(search);
  useEffect(()=>setInput(search),[search]);
  const query=useQuery({queryKey:["admin-workbench",locale,queue,search,mine,page], queryFn:({signal})=>operationsService.workbench({queue,search,mine,page},locale,signal),refetchInterval:60_000});
  const options=useQuery({queryKey:["form-options",locale],queryFn:()=>optionService.getFormOptions(locale)});
  function change(values: Record<string,string>) {const next=new URLSearchParams(params);next.set("page","1");for(const [key,value] of Object.entries(values))value?next.set(key,value):next.delete(key);setParams(next);}
  function submit(e:FormEvent){e.preventDefault();change({q:input.trim()});}
  const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(value));
  return <main className="operations-workbench pagination-layout" aria-label={t("operations.workbench")}>
    <div className="operations-toolbar">
      <form role="search" onSubmit={submit}><input type="search" value={input} onChange={e=>setInput(e.target.value)} placeholder={t("admin.projects.search")} aria-label={t("admin.projects.search")}/></form>
      <Link to={`/${locale}/reports`}>{t("productivity.reports")}</Link>
      {permissions.includes("admin.projects.workflow")&&<button onClick={()=>{setSelecting(!selecting);setSelected([]);}}>{t(selecting?"productivity.exitSelection":"productivity.select")}</button>}
      {selecting&&<><span>{t("productivity.selected",{count:selected.length})}</span><button disabled={!selected.length} onClick={()=>setBatch({flowId:crypto.randomUUID(),ids:selected,returnSearch:location.search,action:"priority",priority:"normal",dueAt:""})}>{t("productivity.batch")}</button></>}
      <SavedViews key={userId} userId={userId} area="workbench" filters={{q:search,queue,mine:String(mine)}} onApply={values=>setParams(new URLSearchParams(values))}/>
      <label className="operations-check"><input type="checkbox" checked={mine} onChange={e=>change({mine:String(e.target.checked)})}/>{t("operations.mine")}</label>
      <button onClick={()=>void query.refetch()} disabled={query.isFetching}>{t("operations.refresh")}</button>
      {query.data&&<span className="muted">{t("operations.total",{count:query.data.total})}</span>}
    </div>
    <div className="operations-queues" aria-label={t("operations.queues")}>
      {query.data?.queues.map(item=><button key={item.id} className={item.id===queue?"selected":""} aria-pressed={item.id===queue} onClick={()=>change({queue:item.id})}><span>{item.label}</span><strong>{item.count}</strong></button>)}
    </div>
    {query.isError?<div className="message error" role="alert">{localizedApiError(query.error,t)}</div>:query.isPending?<p role="status">{t("common.loading")}</p>:<>
      <div className="operations-table pagination-scroll" aria-busy={query.isFetching}><table>
        <thead><tr>{selecting&&<th><input type="checkbox" aria-label={t("productivity.selectPage")} checked={!!query.data.items.length&&query.data.items.every(item=>selected.includes(item.id))} onChange={e=>setSelected(e.target.checked?[...new Set([...selected,...query.data.items.map(item=>item.id)])].slice(0,50):selected.filter(id=>!query.data.items.some(item=>item.id===id)))}/></th>}<th>{t("operations.project")}</th><th>{t("admin.projects.workflow")}</th><th>{t("admin.projects.priority")}</th><th>{t("admin.projects.assignee")}</th><th>{t("operations.deadline")}</th><th>{t("operations.updated")}</th></tr></thead>
        <tbody>{query.data.items.map(item=><tr key={item.id}>
          {selecting&&<td><input type="checkbox" aria-label={t("productivity.selectNamed",{name:item.projectName||item.bookTitle})} checked={selected.includes(item.id)} disabled={!selected.includes(item.id)&&selected.length>=50} onChange={()=>toggle(item.id)}/></td>}
          <td><Link to={localizedPath(locale,"/projects?project="+encodeURIComponent(item.id))}>{item.projectName||item.bookTitle||item.taskNumber||"—"}</Link><small>{[item.taskNumber, item.ownerName || t("accountClosure.deleted")].filter(Boolean).join(" · ")}</small></td>
          <td><span className={"status status-"+item.workflowStatus}>{options.data?.workflowStatuses.find(o=>o.id===item.workflowStatus)?.label??t("uiDensity.unavailableOption")}</span></td>
          <td>{options.data?.projectPriorities.find(o=>o.id===item.priority)?.label??t("uiDensity.unavailableOption")}</td>
          <td>{item.assigneeName??t("admin.projects.unassigned")}</td>
          <td className={item.dueAt&&Date.parse(item.dueAt)<=Date.parse(query.data.serverTime)?"operations-overdue":""}>{item.dueAt?date(item.dueAt):"—"}</td><td>{date(item.updatedAt)}</td>
        </tr>)}</tbody>
      </table>{!query.data.items.length&&<p className="operations-empty">{t("operations.empty")}</p>}</div>
      <div className="operations-pagination pagination-footer"><button disabled={page<=1||query.isFetching} onClick={()=>change({page:String(page-1)})}>{t("operations.previous")}</button><span>{t("operations.page",{page,pages:Math.max(1,Math.ceil(query.data.total/query.data.pageSize))})}</span><button disabled={page*query.data.pageSize>=query.data.total||query.isFetching} onClick={()=>change({page:String(page+1)})}>{t("operations.next")}</button></div>
    </>}
    {batch&&<BatchEditor initial={batch} locale={locale} permissions={permissions} onClose={closeBatch}/>}
  </main>;
}
