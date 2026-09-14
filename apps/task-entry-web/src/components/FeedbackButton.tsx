import {FeedbackImageError,prepareFeedbackScreenshot} from "../prepare-feedback-screenshot";
import {useRef,useState,type FormEvent} from "react";
import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {NoticeModal} from "@lifewood/ui/notifications";
import {ApiError,feedbackService,localizedApiError,type FeedbackInput} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import "./feedback.css";

export function FeedbackButton({locale}:{locale:SupportedLocale}) {
 const {t}=useTranslation();const [open,setOpen]=useState(false),[description,setDescription]=useState(""),[category,setCategory]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[done,setDone]=useState(false);
 const [image,setImage]=useState<{base64:string;type:string;name:string}>();const [pagePath,setPagePath]=useState("");
 const id=useRef(crypto.randomUUID().replaceAll("-","")),fileRead=useRef(0),attempt=useRef<FeedbackInput|null>(null);
 const catalog=useQuery({queryKey:["feedback-catalog",locale],queryFn:()=>feedbackService.catalog(locale),enabled:open});
 const readImage=async(file?:File)=>{const ticket=++fileRead.current;setError("");setReading(false);if(!file){setImage(undefined);return;}
  setReading(true);try{const prepared=await prepareFeedbackScreenshot(file,{sourceMaxBytes:catalog.data?.screenshotSourceMaxBytes??10_000_000,storedMaxBytes:catalog.data?.screenshotMaxBytes??1_000_000});if(ticket!==fileRead.current)return;const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error());reader.readAsDataURL(prepared);});if(ticket===fileRead.current)setImage({base64,type:prepared.type,name:prepared.name});}catch(e){if(ticket===fileRead.current)setError(t(e instanceof FeedbackImageError?"feedback.errors.image":"feedback.errors.imageProcessing"));}finally{if(ticket===fileRead.current)setReading(false);}
 };
 const submit=async(event:FormEvent)=>{event.preventDefault();if(busy||reading)return;setBusy(true);setError("");
  const input=attempt.current??{id:id.current,description:description.trim(),category:category||catalog.data?.categories[0]?.id||"",pagePath,...(image?{screenshotBase64:image.base64,screenshotType:image.type}:{})};attempt.current=input;
  try{await feedbackService.submit(input);setDone(true);setDescription("");setImage(undefined);setCategory("");attempt.current=null;id.current=crypto.randomUUID().replaceAll("-","");}
  catch(e){if(e instanceof ApiError&&["feedback.invalid","feedback.image","feedback.limited"].includes(e.details.code))attempt.current=null;setError(localizedApiError(e,t));}finally{setBusy(false);}
 };
 return <><button type="button" className="feedback-trigger" data-icon-motion="press" aria-label={t("feedback.entry")} title={t("feedback.entry")} onClick={()=>{if(!description&&!attempt.current)setPagePath(window.location.pathname);setDone(false);setOpen(true);}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M12 8v4m0 3h.01"/></svg></button>
 {open&&<NoticeModal title={t("feedback.entry")} onClose={()=>{if(!busy&&!reading)setOpen(false);}}>{done?<div className="feedback-success" role="status"><strong>{t("feedback.submitted")}</strong><p>{t("feedback.replyHint")}</p><button className="button" onClick={()=>setOpen(false)}>{t("common.close")}</button></div>:<form className="feedback-form" onSubmit={event=>void submit(event)}>
 {catalog.isPending?<p role="status">{t("common.loading")}</p>:catalog.isError?<p role="alert">{t("feedback.loadError")} <button type="button" onClick={()=>void catalog.refetch()}>{t("feedback.retry")}</button></p>:<>
 <label>{t("feedback.category")}<select aria-label={t("feedback.category")} disabled={busy||!!attempt.current} value={category||catalog.data?.categories[0]?.id||""} onChange={e=>setCategory(e.target.value)}>{catalog.data?.categories.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
 <label>{t("feedback.description")}<textarea aria-label={t("feedback.description")} autoFocus required minLength={5} maxLength={4000} rows={5} disabled={busy||!!attempt.current} value={description} placeholder={t("feedback.placeholder")} onChange={e=>setDescription(e.target.value)}/></label>
 <label>{t("feedback.screenshot")}<span className="feedback-file-control"><span>{t("feedback.chooseImage")}</span><span>{image?.name??t("feedback.noImage")}</span><input type="file" aria-label={t("feedback.screenshot")} accept="image/png,image/jpeg,image/webp" disabled={busy||reading||!!attempt.current} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void readImage(file);}}/></span></label>
 {image&&<div className="feedback-image-preview"><img src={`data:${image.type};base64,${image.base64}`} alt={t("feedback.screenshot")}/><button type="button" disabled={busy||!!attempt.current} onClick={()=>void readImage()}>{t("feedback.removeImage")}</button></div>}
 {reading&&<p role="status">{t("feedback.processingImage")}</p>}<small>{t("feedback.imageHint")}</small><small className="feedback-context">{t("feedback.page")}: {pagePath}</small>
 </>}
 {error&&<p role="alert">{error}</p>}{attempt.current&&!busy&&error&&<small>{t("feedback.retryHint")}</small>}
 <footer><button type="button" className="button secondary" disabled={busy||reading} onClick={()=>setOpen(false)}>{t("common.cancel")}</button><button className="button" type="submit" disabled={busy||reading||!catalog.data||description.trim().length<5}>{t(busy?"feedback.sending":attempt.current?"feedback.retry":"feedback.submit")}</button></footer>
 </form>}</NoticeModal>}</>;
}
