import {ProjectAction} from "./ProjectAction";
import {useEffect,useId,useRef,useState,type FormEvent} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {operationsService,localizedApiError} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import {ModalFrame} from "./ModalFrame";
import "./operations.css";

export function ProjectOperations({id,locale,permissions,workflow}: {id:string;locale:SupportedLocale;permissions:string[];workflow:string}) {
  const {t}=useTranslation(), title=useId(), client=useQueryClient();
  const followup=useQuery({queryKey:["project-followup",id],queryFn:({signal})=>operationsService.followup(id,signal)});
  const [editing,setEditing]=useState(false),[date,setDate]=useState(""),[version,setVersion]=useState(0);
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState<unknown>();
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const save=useMutation({mutationFn:(due:string|null)=>operationsService.saveFollowup(id,due,version),onSuccess:async data=>{client.setQueryData(["project-followup",id],data);setEditing(false);await client.invalidateQueries({queryKey:["admin-workbench"]});},onError:()=>{void followup.refetch();}});
  function open(){if(!followup.data)return;save.reset();setVersion(followup.data.version);const d=followup.data.dueAt?new Date(followup.data.dueAt):null;setDate(d?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):"");setEditing(true);}
  function submit(e:FormEvent){e.preventDefault();if(!save.isPending&&date)save.mutate(new Date(date).toISOString());}
  async function download(){const abort=new AbortController();controller.current=abort;setExporting(true);setExportError(undefined);try{
    const blob=await operationsService.export(id,locale,abort.signal);if(abort.signal.aborted)return;
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=id+".zip";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);
  }catch(error){if(!abort.signal.aborted)setExportError(error);}finally{if(controller.current===abort){controller.current=null;setExporting(false);}}}
  const terminal=["completed","closed"].includes(workflow);
  return <section className="project-operations">
    <div className="operations-summary"><span><strong>{t("operations.deadline")}</strong> · {followup.isPending?t("common.loading"):followup.data?.dueAt?new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(followup.data.dueAt)):t("operations.notSet")}</span>
      <ProjectAction slot="operations">{permissions.includes("admin.projects.workflow")&&<button onClick={open} disabled={!followup.data}>{t("operations.editDeadline")}</button>}
      {permissions.includes("admin.projects.export")&&<button onClick={()=>void download()} disabled={exporting}>{t(exporting?"operations.exporting":"operations.export")}</button>}
      {exporting&&<button onClick={()=>controller.current?.abort()}>{t("common.cancel")}</button>}</ProjectAction>
    </div>
    {followup.isError&&<div role="alert" className="message error">{localizedApiError(followup.error,t)}<button onClick={()=>void followup.refetch()}>{t("operations.refresh")}</button></div>}
    {Boolean(exportError)&&<p role="alert" className="message error">{localizedApiError(exportError,t)}</p>}
    {editing&&<ModalFrame labelledBy={title} busy={save.isPending} onClose={()=>setEditing(false)}><form onSubmit={submit} className="operations-followup-form">
      <h2 id={title}>{t("operations.deadline")}</h2><p className="muted">{t("uiDensity.deadlineHint")}</p>
      <label>{t("operations.localTime")}<input type="datetime-local" required value={date} min="2000-01-01T00:00" max="2100-12-31T23:59" disabled={terminal||save.isPending} onChange={e=>setDate(e.target.value)}/></label>
      {terminal&&<p>{t("operations.terminal")}</p>}
      {save.isError&&<p className="message error" role="alert">{localizedApiError(save.error,t)}</p>}
      <div className="operations-summary"><button type="button" disabled={save.isPending} onClick={()=>setEditing(false)}>{t("common.cancel")}</button><button type="button" disabled={save.isPending||!followup.data?.dueAt} onClick={()=>save.mutate(null)}>{t("operations.complete")}</button><button className="primary" disabled={save.isPending||terminal||!date}>{t("common.save")}</button></div>
    </form></ModalFrame>}
  </section>;
}
