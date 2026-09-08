import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { authService, localizedApiError, type LoginCredentials } from "@lifewood/api-client";
import type { CurrentUser } from "@lifewood/domain";
import { NoticeModal } from "./Notifications";
import { useConfirmation } from "./confirmation";
import "./account-switcher.css";

export function AccountSessionGuard({userId}:{userId:string}) {
  const {t}=useTranslation();const [changed,setChanged]=useState(false);
  useEffect(()=>{
    let live=true;
    const mark=()=>{if(live)setChanged(true);};
    const check=()=>{if(document.visibilityState==='visible')void authService.checkActiveAccount(userId).then(ok=>{if(!ok&&live)authService.notifyAccountChanged();}).catch(()=>{});};
    window.addEventListener('lw-account-changed',mark);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    const timer=window.setInterval(check,15000);
    return()=>{live=false;clearInterval(timer);window.removeEventListener('lw-account-changed',mark);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  },[userId]);
  return changed?<NoticeModal title={t('accountSwitch.title')} onClose={()=>{}}><p>{t('accountSwitch.changed')}</p><button type="button" onClick={()=>window.location.reload()}>{t('accountSwitch.reload')}</button></NoticeModal>:null;
}

export function AccountSwitcher({user,destination}:{user:CurrentUser;destination:(user:CurrentUser)=>string}) {
  const {t}=useTranslation();const client=useQueryClient();
  const confirm=useConfirmation({title:t('common.confirmTitle'),confirm:t('common.confirmAction'),cancel:t('common.cancel')});
  const [adding,setAdding]=useState(false);const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [rememberMe,setRememberMe]=useState(false);
  const accounts=useQuery({queryKey:['saved-accounts',user.id],queryFn:authService.savedAccounts});
  const switcher=useMutation({mutationFn:async(value:string|LoginCredentials)=>{
    await client.cancelQueries();
    return typeof value==='string'?authService.switchAccount(value):authService.addAccount(value);
  },onSuccess:next=>{setPassword('');client.clear();window.location.replace(destination(next));}});
  const remove=useMutation({mutationFn:authService.removeAccount,onSuccess:()=>client.invalidateQueries({queryKey:['saved-accounts',user.id]})});
  const busy=switcher.isPending||remove.isPending;
  const run=async(value:string|LoginCredentials)=>{
    if(busy)return;
    if(document.body.dataset.unsavedChanges==='true'&&!await confirm(t('wizard.unsavedChanges'),false))return;
    switcher.mutate(value);
  };
  return <section className="account-switcher" aria-label={t('accountSwitch.title')}>
      <h3 className="account-switch-heading">{t('accountSwitch.title')}</h3>
      {accounts.isPending&&<p role="status">{t('common.loading')}</p>}
      {accounts.error&&<p role="alert">{localizedApiError(accounts.error,t)} <button type="button" onClick={()=>void accounts.refetch()}>{t('common.retry')}</button></p>}
      <ul className="saved-account-list">{accounts.data?.items.filter(account=>!account.current).map(account=><li key={account.id}>
        <button className="saved-account-select" type="button" disabled={busy} aria-label={t('accountSwitch.switchNamed',{name:account.displayName})} onClick={()=>void run(account.id)}>
          <span className="saved-account-initial" aria-hidden="true">{account.displayName.slice(0,1)}</span><span><strong>{account.displayName}</strong><small>{account.email}</small></span>
        </button>
        <button className="saved-account-remove" type="button" disabled={busy} aria-label={t('accountSwitch.removeNamed',{name:account.displayName})} title={t('accountSwitch.removeNamed',{name:account.displayName})} onClick={()=>remove.mutate(account.id)}>×</button>
      </li>)}</ul>
      {(switcher.error||remove.error)&&!adding&&<p role="alert">{localizedApiError(switcher.error??remove.error,t)}</p>}
      {switcher.isPending&&!adding&&<p role="status">{t('accountSwitch.switching')}</p>}
      <button className="account-switch-add" type="button" disabled={busy||!accounts.isSuccess||(accounts.data?.items.length??0)>=(accounts.data?.limit??5)} onClick={()=>{switcher.reset();setAdding(true);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m3-15v8m-4-4h8"/></svg>{t('accountSwitch.add')}</button>
      {adding&&<NoticeModal title={t('accountSwitch.add')} onClose={()=>{if(!busy){setAdding(false);setPassword('');}}}>
        <p className="account-switch-hint">{t('accountSwitch.hint')}</p>
        <form className="account-switch-form" onSubmit={e=>{e.preventDefault();void run({email:email.trim(),password,rememberMe});}}>
          <label>{t('auth.email')}<input type="email" autoComplete="username" required value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>
          <label>{t('auth.password')}<input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
          <label className="account-switch-remember"><input type="checkbox" checked={rememberMe} disabled={busy} onChange={e=>setRememberMe(e.target.checked)}/>{t('auth.rememberMe')}</label>
          {switcher.error&&<p role="alert">{localizedApiError(switcher.error,t)}</p>}
          <div className="account-switch-actions"><button type="button" disabled={busy} onClick={()=>{setAdding(false);setPassword('');switcher.reset();}}>{t('common.cancel')}</button><button type="submit" disabled={busy}>{t(switcher.isPending?'accountSwitch.switching':'accountSwitch.addAndSwitch')}</button></div>
        </form>
        <p className="account-switch-hint">{t('accountSwitch.logoutHint')}</p>
      </NoticeModal>}
    </section>;
}
