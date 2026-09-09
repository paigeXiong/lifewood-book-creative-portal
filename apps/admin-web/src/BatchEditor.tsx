import {useId,useState} from "react";
import {useLocation,useNavigate} from "react-router-dom";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {productivityService,optionService,localizedApiError,type BatchPreview,type BatchRequest} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import {ModalFrame} from "./ModalFrame";
import {closeWorkflowDraft,isClosed} from "./WorkflowEditor";
import "./productivity.css";
export type BatchDraft={flowId:string;ids:string[];returnSearch:string;action:BatchRequest["action"];priority:string;assigneeId?:string;assigneeName?:string;dueAt:string;preview?:BatchPreview[]};
export function readBatchDraft(state:unknown):BatchDraft|undefined {const value=(state as {batchEditor?:BatchDraft}|null)?.batchEditor;return value&&typeof value.flowId==="string"&&!isClosed(value.flowId)&&Array.isArray(value.ids)&&value.ids.length>0&&value.ids.length<=50&&value.ids.every(id=>typeof id==="string")&&typeof value.returnSearch==="string"&&typeof value.priority==="string"&&typeof value.dueAt==="string"&&["priority","assign","followup"].includes(value.action)?value:undefined;}
export function BatchEditor({initial,locale,permissions,onClose}:{initial:BatchDraft;locale:SupportedLocale;permissions:string[];onClose:()=>void}){
 const {t}=useTranslation(),title=useId(),client=useQueryClient(),location=useLocation(),navigate=useNavigate();
 const [draft,setDraft]=useState(initial),[result,setResult]=useState<{id:string;outcome:string}[]>();
 const query=useQuery({queryKey:["batch-preview",initial.flowId],queryFn:()=>productivityService.preview(initial.ids),initialData:initial.preview,staleTime:Infinity});
 const options=useQuery({queryKey:["form-options",locale],queryFn:()=>optionService.getFormOptions(locale)});
 const save=useMutation({mutationFn:()=>productivityService.batch({action:draft.action,items:query.data??[],priority:draft.priority,assigneeId:draft.assigneeId??null,dueAt:draft.dueAt?new Date(draft.dueAt).toISOString():null}),onSuccess:async rows=>{setResult(rows);await Promise.all(["admin-workbench","admin-projects","admin-project","admin-overview","admin-reports"].map(key=>client.invalidateQueries({queryKey:[key]})));}});
 const close=()=>{closeWorkflowDraft(draft.flowId);onClose();};
 return <ModalFrame labelledBy={title} busy={save.isPending} onClose={close}><h2 id={title}>{t("productivity.batch")}</h2>
  <p>{t("productivity.selected",{count:initial.ids.length})}</p>
  {query.isPending?<p>{t("common.loading")}</p>:query.error?<p role="alert">{localizedApiError(query.error,t)}<button onClick={()=>void query.refetch()}>{t("common.retry")}</button></p>:result?<><ul className="batch-results">{initial.ids.map(id=><li key={id}><span>{query.data?.find(p=>p.id===id)?.name||t("productivity.unavailableProject")}</span><strong>{t("productivity.outcomes."+(result.find(row=>row.id===id)?.outcome??"NotFound"))}</strong></li>)}</ul></>:<form className="batch-form" onSubmit={event=>{event.preventDefault();if(!save.isPending)save.mutate();}}>
   <label>{t("productivity.action")}<select value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value as BatchDraft["action"]})}><option value="priority">{t("admin.projects.priority")}</option>{permissions.includes("admin.projects.assign")&&<option value="assign">{t("admin.projects.assignee")}</option>}<option value="followup">{t("operations.deadline")}</option></select></label>
   {draft.action==="priority"&&<fieldset className="batch-priorities"><legend>{t("admin.projects.priority")}</legend>{options.data?.projectPriorities.map(option=><label key={option.id}><input type="radio" checked={draft.priority===option.id} name="priority" onChange={()=>setDraft({...draft,priority:option.id})}/>{option.label}</label>)}</fieldset>}
   {draft.action==="assign"&&<div className="batch-assignee"><span>{draft.assigneeName??t("admin.projects.unassigned")}</span><button type="button" onClick={()=>{const next={...draft,preview:query.data};navigate(location.pathname+location.search,{replace:true,state:{batchEditor:next}});navigate(`/${locale}/users?pick=batch-assignee`,{state:{batchEditor:next}});}}>{t("workflowPicker.choose")}</button>{draft.assigneeId&&<button type="button" onClick={()=>setDraft({...draft,assigneeId:undefined,assigneeName:undefined})}>{t("workflowPicker.clear")}</button>}</div>}
   {draft.action==="followup"&&<label>{t("operations.deadline")}<input type="datetime-local" value={draft.dueAt} onChange={e=>setDraft({...draft,dueAt:e.target.value})}/><small>{t("productivity.clearDeadline")}</small></label>}
   <p className="muted">{t("productivity.batchCheck",{count:query.data?.length??0})}</p>
   <details><summary>{t("productivity.preview")}</summary><ul>{query.data?.map(item=><li key={item.id}>{item.name||t("productivity.unnamedProject")}</li>)}</ul></details>
   {save.error&&<p role="alert">{localizedApiError(save.error,t)}<button type="button" onClick={()=>{save.reset();void query.refetch();}}>{t("operations.refresh")}</button></p>}
   <div className="modal-actions"><button type="button" disabled={save.isPending} onClick={close}>{t("common.cancel")}</button><button className="primary" disabled={save.isPending||!query.data?.length||draft.action==="priority"&&!options.data?.projectPriorities.some(p=>p.id===draft.priority)}>{t("common.save")}</button></div>
  </form>}
  {(result||query.error)&&<div className="modal-actions"><button onClick={close}>{t("common.close")}</button></div>}
 </ModalFrame>;
}
