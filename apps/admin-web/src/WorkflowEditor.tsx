import {useId,useState} from "react";
import {useLocation,useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import type {AdminProjectDetail,ConfigOption,ProjectPriority,SupportedLocale,WorkflowStatus} from "@lifewood/domain";
import {localizedApiError} from "@lifewood/api-client";
import {ModalFrame} from "./ModalFrame";
import "./workflow-editor.css";

export type WorkflowDraft={flowId:string;projectId:string;projectSearch:string;workflowStatus:WorkflowStatus;priority:ProjectPriority;assigneeUserId?:string;assigneeName?:string;expectedUpdatedAt:string};
const closedFlows=new Set<string>();
export function closeWorkflowDraft(flowId:string){closedFlows.add(flowId);try{sessionStorage.setItem(`lw.workflow.closed:${flowId}`,"1");}catch{/* Memory fallback when session storage is unavailable. */}}
export function isClosed(flowId:string){if(closedFlows.has(flowId))return true;try{return sessionStorage.getItem(`lw.workflow.closed:${flowId}`)==="1";}catch{return false;}}
export function workflowReturnPath(locale:SupportedLocale,draft:WorkflowDraft){const q=new URLSearchParams(draft.projectSearch);q.set("project",draft.projectId);return `/${locale}/projects?${q}`;}
export function workflowRouteDraft(state:unknown,projectId?:string):WorkflowDraft|undefined{
 const draft=(state as {workflowEditor?:WorkflowDraft}|null)?.workflowEditor;
 return draft&&typeof draft.flowId==="string"&&!isClosed(draft.flowId)&&typeof draft.projectId==="string"&&typeof draft.projectSearch==="string"&&typeof draft.expectedUpdatedAt==="string"&&typeof draft.workflowStatus==="string"&&typeof draft.priority==="string"&&(!projectId||draft.projectId===projectId)?draft:undefined;
}
export function WorkflowEditor({detail,initialDraft,locale,permissions,workflowOptions,priorityOptions,busy,error,onSave,onClose}:{detail:AdminProjectDetail;initialDraft?:WorkflowDraft;locale:SupportedLocale;permissions:string[];workflowOptions:ConfigOption[];priorityOptions:ConfigOption[];busy:boolean;error:unknown;onSave:(draft:WorkflowDraft)=>Promise<void>;onClose:()=>void}){
 const {t}=useTranslation(),location=useLocation(),navigate=useNavigate(),title=useId();
 const [draft,setDraft]=useState<WorkflowDraft>(()=>initialDraft??{flowId:crypto.randomUUID(),projectId:detail.project.id,projectSearch:location.search,workflowStatus:detail.workflowStatus,priority:detail.priority,assigneeUserId:detail.assigneeUserId,assigneeName:detail.assigneeName,expectedUpdatedAt:detail.workflowUpdatedAt});
 const close=()=>{closeWorkflowDraft(draft.flowId);onClose();};
 const canAssign=permissions.includes("admin.projects.assign");
 return <ModalFrame labelledBy={title} busy={busy} onClose={close}><h2 id={title}>{t("projectActions.editWorkflow")}</h2>
  <form className="workflow-editor" onSubmit={event=>{event.preventDefault();if(!busy)void onSave({...draft,assigneeUserId:canAssign?draft.assigneeUserId:detail.assigneeUserId}).then(close).catch(()=>{});}}>
   {([{name:"workflowStatus",label:t("admin.projects.workflow"),items:workflowOptions},{name:"priority",label:t("admin.projects.priority"),items:priorityOptions}] as const).map(group=><fieldset key={group.name} disabled={busy} className="workflow-choices"><legend>{group.label}</legend><div>{group.items.map(item=><label key={item.id} className="workflow-choice"><input type="radio" required name={group.name} value={item.id} checked={draft[group.name]===item.id} onChange={()=>setDraft(current=>({...current,[group.name]:item.id}))}/><span>{item.label}</span></label>)}</div></fieldset>)}
   <div className="workflow-assignee"><span>{t("admin.projects.assignee")}</span><div><strong>{draft.assigneeName??t("admin.projects.unassigned")}</strong>{canAssign&&<div className="workflow-assignee-actions"><button type="button" disabled={busy} onClick={()=>{navigate(location.pathname+location.search,{replace:true,state:{workflowEditor:draft}});navigate(`/${locale}/users?pick=assignee`,{state:{workflowEditor:draft}});}}>{t(draft.assigneeUserId?"workflowPicker.change":"workflowPicker.choose")}</button>{draft.assigneeUserId&&<button type="button" disabled={busy} onClick={()=>setDraft(current=>({...current,assigneeUserId:undefined,assigneeName:undefined}))}>{t("workflowPicker.clear")}</button>}</div>}</div></div>
   {Boolean(error)&&<div className="message error" role="alert">{localizedApiError(error,t)}</div>}
   <div className="modal-actions"><button type="button" disabled={busy} onClick={close}>{t("common.cancel")}</button><button className="primary" disabled={busy||!workflowOptions.some(item=>item.id===draft.workflowStatus)||!priorityOptions.some(item=>item.id===draft.priority)}>{t("common.save")}</button></div>
  </form></ModalFrame>;
}
