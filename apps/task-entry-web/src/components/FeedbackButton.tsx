import {FeedbackImageError,prepareFeedbackScreenshot} from "../prepare-feedback-screenshot";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {NoticeModal} from "@lifewood/ui/notifications";
import {HelpPopover} from "@lifewood/ui/help-popover";
import {ApiError,captureAccountGuard,feedbackService,localizedApiError,type FeedbackInput} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import "./feedback.css";

export function FeedbackButton({locale,userId}:{locale:SupportedLocale;userId:string}) {
 return <AccountFeedback key={userId} locale={locale} userId={userId}/>;
}
function AccountFeedback({locale,userId}:{locale:SupportedLocale;userId:string}) {
 const {t}=useTranslation();const [open,setOpen]=useState(false),[description,setDescription]=useState(""),[category,setCategory]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[done,setDone]=useState(false);
 const [image,setImage]=useState<{base64:string;type:string;name:string}>();const [pagePath,setPagePath]=useState("");
 const fileInput=useRef<HTMLInputElement>(null);
 const id=useRef(crypto.randomUUID().replaceAll("-","")),fileRead=useRef(0),attempt=useRef<FeedbackInput|null>(null);
 const client=useQueryClient(),lifetime=useRef({mounted:false,changed:false}),submitLock=useRef(false),readingLock=useRef(false),readerRef=useRef<FileReader|null>(null);
 const [invalidated,setInvalidated]=useState(false);
 const isCurrent=()=>lifetime.current.mounted&&!lifetime.current.changed&&client.getQueryData<{id:string}>(["current-user"])?.id===userId;
 const cancelRead=()=>{fileRead.current++;readingLock.current=false;readerRef.current?.abort();readerRef.current=null;};
 useEffect(()=>{
  lifetime.current.mounted=true;
  const stop=()=>{lifetime.current.changed=true;cancelRead();attempt.current=null;setDescription("");setImage(undefined);setCategory("");setPagePath("");setError("");setReading(false);setDone(false);setInvalidated(true);};
  window.addEventListener("lw-account-changed",stop);
  return()=>{lifetime.current.mounted=false;cancelRead();attempt.current=null;window.removeEventListener("lw-account-changed",stop);};
 },[]);
 const catalog=useQuery({queryKey:["feedback-catalog",locale],queryFn:()=>feedbackService.catalog(locale),enabled:open&&!invalidated,retry:false});
 const catalogReady=!!catalog.data&&!catalog.error&&catalog.fetchStatus==="idle";
 const close=()=>{if(submitLock.current&&!invalidated)return;cancelRead();setReading(false);setOpen(false);};
 const readImage=async(file?:File)=>{
  if(!isCurrent()||submitLock.current||attempt.current)return;
  cancelRead();const ticket=fileRead.current;const guard=captureAccountGuard();
  const active=()=>isCurrent()&&ticket===fileRead.current;
  setError("");setReading(false);if(!file){setImage(undefined);return;}
  if(!catalogReady)return;
  readingLock.current=true;setReading(true);
  try{
   guard();
   const prepared=await prepareFeedbackScreenshot(file,{sourceMaxBytes:catalog.data.screenshotSourceMaxBytes,storedMaxBytes:catalog.data.screenshotMaxBytes});
   if(!active())return;guard();
   const base64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();readerRef.current=reader;
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.onerror=()=>reject(new Error());reader.onabort=()=>reject(new Error());reader.readAsDataURL(prepared);
   });
   if(!active())return;guard();setImage({base64,type:prepared.type,name:prepared.name});
  }catch(e){if(active())setError(e instanceof ApiError?localizedApiError(e,t):t(e instanceof FeedbackImageError?"feedback.errors.image":"feedback.errors.imageProcessing"));}
  finally{if(active()){readerRef.current=null;readingLock.current=false;setReading(false);}}
 };
 const submit=async(event:FormEvent)=>{event.preventDefault();if(!isCurrent()||submitLock.current||readingLock.current||!catalogReady||description.trim().length<5)return;submitLock.current=true;setBusy(true);setError("");
  const guard=captureAccountGuard();
  const input=attempt.current??{id:id.current,description:description.trim(),category:category||catalog.data?.categories[0]?.id||"",pagePath,...(image?{screenshotBase64:image.base64,screenshotType:image.type}:{})};attempt.current=input;
  try{guard();await feedbackService.submit(input);if(!isCurrent())return;guard();setDone(true);setDescription("");setImage(undefined);setCategory("");attempt.current=null;id.current=crypto.randomUUID().replaceAll("-","");}
  catch(e){if(isCurrent()){if(e instanceof ApiError&&["feedback.invalid","feedback.image","feedback.limited"].includes(e.details.code))attempt.current=null;setError(localizedApiError(e,t));}}finally{if(isCurrent()){submitLock.current=false;setBusy(false);}}
 };
 return <><button type="button" className="feedback-trigger" disabled={invalidated} data-icon-motion="press" aria-label={t("feedback.entry")} title={t("feedback.entry")} onClick={()=>{if(!description&&!attempt.current)setPagePath(window.location.pathname);setDone(false);setOpen(true);}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M12 8v4m0 3h.01"/></svg></button>
 {open&&<NoticeModal title={t("feedback.entry")} onClose={close}>{invalidated?<p role="alert">{t("accountSwitch.changed")}</p>:done?<div className="feedback-success" role="status"><strong>{t("feedback.submitted")}</strong><p>{t("feedback.replyHint")}</p><button className="button" onClick={()=>setOpen(false)}>{t("common.close")}</button></div>:<form className="feedback-form" onSubmit={event=>void submit(event)}>
 {catalog.isPending?<p role="status">{t("common.loading")}</p>:catalog.isError?<p role="alert">{t("feedback.loadError")} <button type="button" onClick={()=>void catalog.refetch()}>{t("feedback.retry")}</button></p>:<>
 <label>{t("feedback.category")}<select aria-label={t("feedback.category")} disabled={busy||!!attempt.current} value={category||catalog.data?.categories[0]?.id||""} onChange={e=>setCategory(e.target.value)}>{catalog.data?.categories.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
 <label>{t("feedback.description")}<textarea aria-label={t("feedback.description")} autoFocus required minLength={5} maxLength={4000} rows={5} disabled={busy||!!attempt.current} value={description} placeholder={t("feedback.placeholder")} onChange={e=>setDescription(e.target.value)}/></label>
 <div className="feedback-screenshot-field"><div className="field-help-heading"><label htmlFor="feedback-screenshot">{t("feedback.screenshot")}</label><HelpPopover label={t("feedback.screenshot")}><p>{t("feedback.imageHint")}</p><p>{t("feedback.page")}: {pagePath}</p></HelpPopover></div><div className="feedback-file-control"><button id="feedback-screenshot" type="button" className="feedback-choose-image" aria-label={t("feedback.chooseImage")} disabled={busy||reading||!!attempt.current||!catalogReady} onClick={()=>fileInput.current?.click()}>{t("feedback.chooseImage")}</button><span className="feedback-file-name" title={image?.name}>{image?.name??t("feedback.noImage")}</span><input ref={fileInput} hidden tabIndex={-1} type="file" aria-label={t("feedback.screenshot")} accept="image/png,image/jpeg,image/webp" disabled={busy||reading||!!attempt.current||!catalogReady} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void readImage(file);}}/></div></div>
 {image&&<div className="feedback-image-preview"><img src={`data:${image.type};base64,${image.base64}`} alt={t("feedback.screenshot")}/><button type="button" disabled={busy||!!attempt.current} onClick={()=>void readImage()}>{t("feedback.removeImage")}</button></div>}
 {reading&&<p role="status">{t("feedback.processingImage")}</p>}
 </>}
 {error&&<p role="alert">{error}</p>}{attempt.current&&!busy&&error&&<small>{t("feedback.retryHint")}</small>}
 <footer><button type="button" className="button secondary" disabled={busy} onClick={close}>{t("common.cancel")}</button><button className="button" type="submit" disabled={busy||reading||!catalogReady||description.trim().length<5}>{t(busy?"feedback.sending":attempt.current?"feedback.retry":"feedback.submit")}</button></footer>
 </form>}</NoticeModal>}</>;
}
