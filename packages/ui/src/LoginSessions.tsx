import {useEffect,useRef,useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {loginDeviceService,localizedApiError,type LoginDevice} from "@lifewood/api-client";
import "./saved-views.css";
export function LoginSessions({userId}:{userId:string}){
 const {t,i18n}=useTranslation(),client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null);
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[target,setTarget]=useState<LoginDevice|"others"|null>(null);
 const query=useQuery({queryKey:["login-devices",userId,page],queryFn:()=>loginDeviceService.list(page),enabled:open,refetchInterval:open?30000:false});
 const revoke=useMutation({mutationFn:()=>target==="others"?loginDeviceService.revokeOthers():loginDeviceService.revoke(target!.id),onSuccess:async()=>{setTarget(null);setPage(1);await client.invalidateQueries({queryKey:["login-devices",userId]});}});
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 const date=(value?:string)=>value?new Date(value).toLocaleString(i18n.language):t("userActivity.noData");
 return <><button type="button" className="login-devices-trigger" onClick={()=>{setOpen(true);setTarget(null);revoke.reset();}}>{t("productivity.devices")}</button>{open&&<dialog aria-label={t("productivity.devices")} ref={dialog} className="saved-views-dialog login-devices-dialog" onCancel={e=>{if(revoke.isPending)e.preventDefault();else setOpen(false);}}>
  <h2>{t("productivity.devices")}</h2>
  {query.isPending?<p role="status">{t("common.loading")}</p>:query.error?<p role="alert">{localizedApiError(query.error,t)}<button onClick={()=>void query.refetch()}>{t("common.retry")}</button></p>:<ul>{query.data?.items.map(item=><li key={item.id} style={{alignItems:"start",flexWrap:"wrap"}}><div style={{flex:1,minWidth:180}}><strong>{t("productivity.browsers."+item.browser)} · {t("productivity.platforms."+item.platform)}</strong>{item.current&&<small> · {t("productivity.currentDevice")}</small>}<p style={{fontSize:12,margin:"5px 0"}}>{t("productivity.connectedAt")} · {date(item.lastSeen)}</p><small>{t("productivity.expiresAt")} · {date(item.expiresAt)}</small></div>{!item.current&&<button disabled={revoke.isPending} onClick={()=>{setTarget(item);revoke.reset();}}>{t("productivity.revoke")}</button>}</li>)}</ul>}
  {target&&<section role="alert"><p>{t(target==="others"?"productivity.revokeOthersConfirm":"productivity.revokeConfirm")}</p><button disabled={revoke.isPending} onClick={()=>revoke.mutate()}>{t("productivity.revoke")}</button><button disabled={revoke.isPending} onClick={()=>setTarget(null)}>{t("common.cancel")}</button></section>}
  {revoke.error&&<p role="alert">{localizedApiError(revoke.error,t)}</p>}
  <footer style={{gap:6,flexWrap:"wrap"}}>{((query.data?.total??0)>20||page>1)&&<><button disabled={page<=1||revoke.isPending} onClick={()=>setPage(page-1)}>{t("operations.previous")}</button><button disabled={!query.data||page*20>=query.data.total||revoke.isPending} onClick={()=>setPage(page+1)}>{t("operations.next")}</button></>}<button disabled={revoke.isPending||!query.data||query.data.total<2} onClick={()=>setTarget("others")}>{t("productivity.revokeOthers")}</button><button disabled={revoke.isPending} onClick={()=>setOpen(false)}>{t("common.close")}</button></footer>
 </dialog>}</>;
}
