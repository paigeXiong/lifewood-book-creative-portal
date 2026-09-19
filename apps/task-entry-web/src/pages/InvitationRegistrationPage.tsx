import {useEffect,useRef,useState,type FormEvent} from "react";
import {Link,useLocation,useNavigate,useParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {invitationService,localizedApiError} from "@lifewood/api-client";
import {isSupportedLocale} from "@lifewood/i18n";
import {HelpPopover} from "@lifewood/ui/help-popover";
import "@lifewood/ui/email";
import "./invitation-registration.css";
export function InvitationRegistrationPage() {
 const location=useLocation();
 const [entry,setEntry]=useState(()=>({key:location.key,hash:location.hash,generation:0}));
 const source=entry.key+":"+entry.generation;
 const cleaned=!location.hash&&location.state?.invitationSource===source;
 if(!cleaned&&(location.key!==entry.key||location.hash!==entry.hash)){setEntry({key:location.key,hash:location.hash,generation:entry.generation+1});return null;}
 return <RegistrationForm key={entry.generation} fragment={entry.hash} source={source}/>;
}
function RegistrationForm({fragment,source}:{fragment:string;source:string}) {
 const {t}=useTranslation(),{locale}=useParams(),location=useLocation(),navigate=useNavigate();
 const [initialCode]=useState(()=>new URLSearchParams(fragment.slice(1)).get("code")?.slice(0,64)??"");
 const [token,setToken]=useState(()=>new URLSearchParams(fragment.slice(1)).get("token")??"");
 const [organization,setOrganization]=useState(""),[sent,setSent]=useState(false),[done,setDone]=useState(false),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[cooldown,setCooldown]=useState(0);
 const [identity,setIdentity]=useState({email:"",displayName:""});
 const [passwordVisible,setPasswordVisible]=useState(false),[mismatch,setMismatch]=useState(false),[inspection,setInspection]=useState(0);
 const confirmation=useRef<HTMLInputElement>(null);
 const lock=useRef(false);
 useEffect(()=>{if(mismatch&&!busy)confirmation.current?.focus();},[mismatch,busy]);
 function restart(){if(lock.current)return;setToken("");setOrganization("");setError(undefined);setMismatch(false);setPasswordVisible(false);setSent(false);setCooldown(0);}

 useEffect(()=>{if(location.hash)navigate({pathname:location.pathname,search:location.search},{replace:true,state:{invitationSource:source}});},[location.hash,location.pathname,location.search,navigate,source]);
 useEffect(()=>{if(!token)return;let cancelled=false;setBusy(true);setError(undefined);invitationService.inspect(token).then(r=>{if(!cancelled){setOrganization(r.organization);setIdentity({email:r.email??"",displayName:r.displayName??""});}}).catch(e=>{if(!cancelled)setError(e);}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};},[token,inspection]);
 useEffect(()=>{if(cooldown<=0)return;const timer=setTimeout(()=>setCooldown(c=>c-1),1000);return()=>clearTimeout(timer);},[cooldown]);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(lock.current||done)return;const f=new FormData(event.currentTarget);lock.current=true;setBusy(true);setError(undefined);
  try {
   if(token){if(f.get("password")!==f.get("confirmation")){setMismatch(true);return;}setMismatch(false);await invitationService.register(token,String(f.get("name")),String(f.get("password")));setDone(true);}
   else {const enteredCode=String(f.get("code")).trim();setOrganization((await invitationService.lookup(enteredCode)).organization);await invitationService.email(enteredCode,String(f.get("email")),locale!,String(f.get("name")).trim());setSent(true);setCooldown(60);}
  }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
 }
 if(!isSupportedLocale(locale))return null;
 return <div className="invitation-registration"><div className="login-heading field-help-heading"><h1 id="login-title">{t("invitation.register")}</h1><HelpPopover label={t("invitation.register")}>{t("invitation.registerHelp")}</HelpPopover><Link className="login-mode-link" to={`/${locale}/login`} state={done?{registrationEmail:identity.email}:undefined}>{t("auth.signIn")}<span aria-hidden="true"> →</span></Link></div>
 {done?<p role="status">{t("invitation.done")}</p>:<form className="login-form" onSubmit={submit} aria-busy={busy}>
 <label className="login-field">{t("invitation.nickname")}<input key={identity.displayName} name="name" defaultValue={identity.displayName} autoComplete="nickname" minLength={2} maxLength={100} required disabled={busy}/></label>
 <label className="login-field">{t("invitation.email")}<input name="email" type="email" defaultValue={identity.email} key={identity.email} autoComplete="email" maxLength={254} required readOnly={!!token} disabled={busy}/></label>
 {!token&&<label className="login-field">{t("invitation.code")}<input name="code" defaultValue={initialCode} required autoComplete="off" maxLength={64} disabled={busy} onChange={()=>{setOrganization("");setSent(false);setError(undefined);}}/></label>}
 {organization&&<p className="registration-organization">{t("invitation.join",{organization})}</p>}
 {token&&organization&&<><p className="registration-verified" role="status">✓ {t("invitation.verified")}</p><div className="registration-passwords">
 <div className="login-field"><div className="field-help-heading"><label htmlFor="registration-password">{t("invitation.password")}</label><HelpPopover label={t("invitation.password")}>{t("invitation.passwordLength")}</HelpPopover></div><span className="password-control"><input id="registration-password" name="password" type={passwordVisible?"text":"password"} autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} onChange={()=>setMismatch(false)}/><button type="button" disabled={busy} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(v=>!v)}>{t(passwordVisible?"auth.hidePassword":"auth.showPassword")}</button></span></div>
 <label className="login-field" htmlFor="registration-confirmation">{t("invitation.confirmPassword")}<input ref={confirmation} id="registration-confirmation" name="confirmation" type={passwordVisible?"text":"password"} autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} aria-invalid={mismatch||undefined} aria-describedby={mismatch?"registration-mismatch":undefined} onChange={()=>setMismatch(false)}/></label>
 {mismatch&&<p id="registration-mismatch" className="field-error" role="alert">{t("invitation.mismatch")}</p>}
 </div></>}
 {token&&error!=null&&<div className="registration-recovery"><button type="button" className="button button-secondary" disabled={busy} onClick={restart}>{t("invitation.restart")}</button>{!organization&&<button type="button" className="button button-secondary" disabled={busy} onClick={()=>setInspection(v=>v+1)}>{t("common.retry")}</button>}</div>}

 {sent&&<p role="status">{t("invitation.sent")}</p>}
 {error!=null&&<p role="alert">{error instanceof Error&&error.message===t("invitation.mismatch")?error.message:localizedApiError(error,t)}</p>}
 <button type="submit" className="button button-primary" disabled={busy||!!token&&!organization||cooldown>0}>{t(busy?"common.loading":token?"invitation.submitRegistration":"invitation.verifyEmail")}{cooldown>0?` (${cooldown})`:""}</button>
 {!token&&<button type="button" className="button registration-pending" disabled>{t("invitation.submitRegistration")}</button>}
 </form>}
 </div>;
}
