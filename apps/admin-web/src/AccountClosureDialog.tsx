import {useId,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {adminService,localizedApiError} from "@lifewood/api-client";
import type {AdminUser} from "@lifewood/domain";
import {ModalFrame} from "./ModalFrame";
import {showAdminToast} from "./Toast";
import "./account-closure.css";
export function AccountClosureDialog({user,onClose}:{user:AdminUser;onClose:()=>void}){
 const {t}=useTranslation(),title=useId(),description=useId(),client=useQueryClient();const [email,setEmail]=useState("");
 const preview=useQuery({queryKey:["account-closure-preview",user.id],queryFn:()=>adminService.accountClosurePreview(user.id),staleTime:0});
 const close=useMutation({mutationFn:()=>adminService.closeAccount(user.id,email,preview.data!.updatedAt),onSuccess:async()=>{
  // Remove cached identity details before refetching directories and project owners.
  client.removeQueries({queryKey:["admin-user-details",user.id]});client.removeQueries({queryKey:["account-closure-preview",user.id]});
  await Promise.all(["admin-users","admin-organizations","admin-project","admin-projects","admin-assignees","admin-workbench","admin-overview","admin-audit-events"].map(key=>client.invalidateQueries({queryKey:[key]})));
  showAdminToast(t("accountClosure.success"));onClose();
 }});
 const ready=preview.data&&email.trim().toLowerCase()===preview.data.email.toLowerCase();
 return <ModalFrame labelledBy={title} busy={close.isPending} onClose={onClose}><h2 id={title}>{t("accountClosure.title")}</h2>
  <form className="account-closure-form" onSubmit={event=>{event.preventDefault();if(ready&&!close.isPending&&!preview.isFetching)close.mutate();}}>
   <p>{t("accountClosure.target",{name:user.displayName})}</p><p id={description}>{t("accountClosure.effect")}</p>
   {preview.isPending?<p role="status">{t("common.loading")}</p>:preview.error?<p role="alert">{localizedApiError(preview.error,t)} <button type="button" onClick={()=>void preview.refetch()}>{t("common.retry")}</button></p>:preview.data&&<>
    <div className="account-closure-impact"><span>{t("accountClosure.owned",{count:preview.data.ownedProjects})}</span><span>{t("accountClosure.assigned",{count:preview.data.assignedProjects})}</span></div>
    <p className="muted">{t("accountClosure.retained")}</p>
    <label><span>{t("accountClosure.confirmEmail")}</span><strong>{preview.data.email}</strong><input type="email" autoComplete="off" spellCheck={false} value={email} onChange={event=>setEmail(event.target.value)} aria-describedby={description} required disabled={close.isPending}/></label>
   </>}
   {close.error&&<p role="alert">{localizedApiError(close.error,t)} <button type="button" disabled={preview.isFetching} onClick={()=>{setEmail("");close.reset();void preview.refetch();}}>{t("accountClosure.review")}</button></p>}
   <div className="modal-actions"><button type="button" disabled={close.isPending} onClick={onClose}>{t("common.cancel")}</button><button className="account-close-confirm" disabled={!ready||preview.isFetching||close.isPending||Boolean(close.error)}>{t(close.isPending?"common.loading":"accountClosure.confirm")}</button></div>
  </form>
 </ModalFrame>;
}
