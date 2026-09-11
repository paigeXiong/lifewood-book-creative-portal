import {useEffect,useRef,useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {personalWorkspaceService,localizedApiError,type SavedView} from "@lifewood/api-client";
import "./saved-views.css";
export function SavedViews({userId,area,filters,onApply}:{userId:string|undefined;area:"tasks"|"workbench"|"projects";filters:Record<string,string>;onApply:(filters:Record<string,string>)=>void}){
 const {t}=useTranslation(),client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null);
 const [open,setOpen]=useState(false),[name,setName]=useState(""),[editing,setEditing]=useState<SavedView|null>(null);
 const key=["saved-views",userId,area],query=useQuery({queryKey:key,queryFn:()=>personalWorkspaceService.views(area),enabled:open&&!!userId});
 const save=useMutation({mutationFn:()=>personalWorkspaceService.saveView(area,editing?.id??crypto.randomUUID().replaceAll("-",""),{name:name.trim(),filters:editing?.filters??filters,version:editing?.version??0}),onSuccess:async()=>{setName("");setEditing(null);await client.invalidateQueries({queryKey:key});}});
 const remove=useMutation({mutationFn:(view:SavedView)=>personalWorkspaceService.deleteView(view.id,view.version),onSuccess:()=>client.invalidateQueries({queryKey:key})});
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 return <><button type="button" className="saved-views-trigger" disabled={!userId} onClick={()=>{setOpen(true);save.reset();remove.reset();}}>{t("productivity.savedViews")}</button>
  {open&&<dialog aria-label={t("productivity.savedViews")} ref={dialog} className="saved-views-dialog" onCancel={event=>{if(save.isPending||remove.isPending)event.preventDefault();else setOpen(false);}}>
   <h2>{t("productivity.savedViews")}</h2>
   {query.isPending?<p>{t("common.loading")}</p>:query.isError?<p role="alert">{localizedApiError(query.error,t)}<button onClick={()=>void query.refetch()}>{t("common.retry")}</button></p>:<ul>{query.data?.map(view=><li key={view.id}><button className="saved-view-name" onClick={()=>{onApply(view.filters);setOpen(false);}}>{view.name}</button><button aria-label={t("productivity.renameNamed",{name:view.name})} onClick={()=>{setEditing(view);setName(view.name);save.reset();}} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>✎</span></button><button disabled={remove.isPending} aria-label={t("productivity.removeNamed",{name:view.name})} onClick={()=>remove.mutate(view)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></li>)}</ul>}
   <form onSubmit={event=>{event.preventDefault();if(!save.isPending&&name.trim())save.mutate();}}><label>{t(editing?"productivity.rename":"productivity.saveCurrent")}<input maxLength={40} required value={name} onChange={event=>setName(event.target.value)} /></label><button disabled={save.isPending||!name.trim()}>{t("common.save")}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setName("");}}>{t("common.cancel")}</button>}</form>
   {(save.error||remove.error)&&<p role="alert">{localizedApiError(save.error??remove.error,t)}</p>}
   <footer><button disabled={save.isPending||remove.isPending} onClick={()=>setOpen(false)}>{t("common.close")}</button></footer>
  </dialog>}</>;
}
