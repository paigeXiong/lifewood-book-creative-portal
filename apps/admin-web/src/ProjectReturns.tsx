import {useLocation} from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { revisionService, localizedApiError, type RevisionReason } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";

export function ProjectReturns({id, version, status, workflowUpdatedAt, locale, renderSnapshot, canReturn = true, canReply = true}: {canReturn?:boolean;canReply?:boolean;id:string;version:number;status:string;workflowUpdatedAt:string;locale:SupportedLocale;renderSnapshot:(snapshot:string)=>ReactNode}) {
  const notification=new URLSearchParams(useLocation().search).get("notification");
  const {t}=useTranslation();const client=useQueryClient();
  const [editing,setEditing]=useState(false),[page,setPage]=useState(1),[selected,setSelected]=useState("");
  const [expected,setExpected]=useState({version,workflowUpdatedAt});
  const [reasons,setReasons]=useState<RevisionReason[]>([]),[reply,setReply]=useState("");
  const key=["admin-revisions",id,locale,page];
  const query=useQuery({queryKey:key,queryFn:()=>revisionService.get(id,locale,true,page),refetchInterval:10000});
  useEffect(()=>{if(!notification||!query.data)return;const element=document.getElementById(`notification-${notification}`);if(element){element.closest("details")?.setAttribute("open","");element.scrollIntoView({block:"center"});}else if(query.data.hasMore)setPage(p=>p+1);},[notification,query.data]);
  const save=useMutation({mutationFn:()=>revisionService.returnProject(id,expected.version,reasons,locale,expected.workflowUpdatedAt),onSuccess:()=>{setEditing(false);setReasons([]);void client.invalidateQueries();}});
  const message=useMutation({mutationFn:({round,unit}:{round:string;unit:string})=>revisionService.reply(id,round,{id:Array.from(crypto.getRandomValues(new Uint8Array(16)), byte=>byte.toString(16).padStart(2,"0")).join(""),unit,body:reply},locale,true),onSuccess:()=>{setReply("");void client.invalidateQueries({queryKey:["admin-revisions",id]});}});
  if(query.isPending)return <p>{t("common.loading")}</p>;
  if(!query.data)return <p role="alert">{localizedApiError(query.error,t)}</p>;
  const {labels,units,rounds}=query.data;
  return <section className="detail-section revision-admin">
    <button className="primary" disabled={!canReturn||status!=="submitted"||save.isPending} onClick={()=>{save.reset();setExpected({version,workflowUpdatedAt});setEditing(true);}}>{labels.return}</button>
    {editing&&<ModalFrame labelledBy="return-title" busy={save.isPending} onClose={()=>setEditing(false)}><form className="revision-return-form" onSubmit={e=>{e.preventDefault();save.mutate();}}><header><div className="revision-dialog-icon" aria-hidden="true">↶</div><h2 id="return-title">{labels.return}</h2><button type="button" className="revision-dialog-close" aria-label={labels.close} disabled={save.isPending} onClick={()=>setEditing(false)}>×</button></header><div className="revision-reason-list">
      {units.map((unit,index)=><div className={`revision-reason ${reasons.some(r=>r.unit===unit.id)?"is-selected":""}`} key={unit.id}><label><input type="checkbox" checked={reasons.some(r=>r.unit===unit.id)} onChange={e=>setReasons(e.target.checked?[...reasons,{unit:unit.id,body:""}]:reasons.filter(r=>r.unit!==unit.id))}/><span className="revision-unit-number" aria-hidden="true">{String(index+1).padStart(2,"0")}</span><strong>{unit.label}</strong><span className="revision-unit-check" aria-hidden="true">✓</span></label>{reasons.some(r=>r.unit===unit.id)&&<textarea required maxLength={2000} aria-label={`${unit.label} · ${labels.reason}`} placeholder={labels.reason} value={reasons.find(r=>r.unit===unit.id)!.body} onChange={e=>setReasons(reasons.map(r=>r.unit===unit.id?{...r,body:e.target.value}:r))}/>}</div>)}
      </div>{save.isError&&<p role="alert">{localizedApiError(save.error,t)}</p>}<footer><button type="button" disabled={save.isPending} onClick={()=>setEditing(false)}>{labels.cancel}</button><button className="primary" disabled={save.isPending||!reasons.length||reasons.some(r=>!r.body.trim())}>{labels.return}{reasons.length>0&&<span className="revision-selected-count">{reasons.length}</span>}</button></footer></form></ModalFrame>}
    {rounds.length>0&&<><h3>{labels.history}</h3>{rounds.map(round=><details id={`notification-${round.id}`} key={round.id} open={!round.submittedAt}><summary>{new Date(round.createdAt).toLocaleString(locale)} · {round.submittedAt?labels.submitted:labels.pending}</summary>
      {round.reasons.map(reason=><section className="revision-thread" key={reason.unit}><h4>{units.find(u=>u.id===reason.unit)?.label}</h4><div className="revision-messages">{round.messages.filter(m=>m.unit===reason.unit).map(m=><article id={`notification-${m.id}`} className="revision-message" key={m.id}>{m.avatarUrl?<img src={m.avatarUrl} alt=""/>:<span className="revision-avatar">{m.authorName.slice(0,2)}</span>}<div><strong>{m.authorName}</strong><time>{new Date(m.createdAt).toLocaleString(locale)}</time><p>{m.body}</p></div></article>)}</div>
      {canReply&&!round.submittedAt&&<form onSubmit={e=>{e.preventDefault();if(reply.trim())message.mutate({round:round.id,unit:reason.unit});}}><textarea aria-label={labels.reply} maxLength={2000} placeholder={labels.reply} value={selected===reason.unit?reply:""} onChange={e=>{setSelected(reason.unit);setReply(e.target.value);}}/><button disabled={message.isPending||selected!==reason.unit||!reply.trim()}>{labels.send}</button></form>}</section>)}
      {round.beforeSnapshot&&<details><summary>{labels.before}</summary>{renderSnapshot(round.beforeSnapshot)}</details>}{round.afterSnapshot&&<details><summary>{labels.after}</summary>{renderSnapshot(round.afterSnapshot)}</details>}
    </details>)}{message.isError&&<p role="alert">{localizedApiError(message.error,t)}</p>}<nav><button disabled={page===1} onClick={()=>setPage(page-1)}>{labels.previous}</button><button disabled={!query.data.hasMore} onClick={()=>setPage(page+1)}>{labels.next}</button></nav></>}
  </section>;
}
