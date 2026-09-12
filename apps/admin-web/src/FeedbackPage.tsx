import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {feedbackService,localizedApiError,type FeedbackDetail,type FeedbackCatalog} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import {NoticeModal} from "@lifewood/ui/notifications";
import {useUnsavedClose} from "./useUnsavedClose";
import {showAdminToast} from "./Toast";
import "./feedback.css";

export function FeedbackPage({locale,userId}:{locale:SupportedLocale;userId:string}) {
 const {t}=useTranslation();const [page,setPage]=useState(1),[search,setSearch]=useState(""),[status,setStatus]=useState(""),[selected,setSelected]=useState<string>();
 const catalog=useQuery({queryKey:["feedback-catalog",locale],queryFn:()=>feedbackService.catalog(locale)});
 const list=useQuery({queryKey:["admin-feedback",userId,page,search,status],queryFn:()=>feedbackService.list(page,search,status)});
 const date=(value:string)=>new Date(value).toLocaleString(locale,{dateStyle:"medium",timeStyle:"short"});
 return <main className="feedback-page" aria-label={t("feedback.adminTitle")}>
 <div className="feedback-toolbar"><input type="search" aria-label={t("feedback.search")} placeholder={t("feedback.search")} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><select aria-label={t("feedback.status")} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t("feedback.allStatuses")}</option>{catalog.data?.statuses.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select><button type="button" onClick={()=>{void list.refetch();void catalog.refetch();}} disabled={list.isFetching}>{t("feedback.refresh")}</button></div>
 {list.isPending?<p role="status">{t("common.loading")}</p>:list.isError?<p role="alert">{localizedApiError(list.error,t)}</p>:<>
 <div className="feedback-table-scroll"><table><thead><tr><th>{t("feedback.description")}</th><th>{t("feedback.author")}</th><th>{t("feedback.status")}</th><th>{t("feedback.createdAt")}</th><th>{t("feedback.view")}</th></tr></thead><tbody>{list.data.items.map(item=><tr key={item.id}><td><strong className="feedback-excerpt">{item.description}</strong><small>{catalog.data?.categories.find(o=>o.id===item.category)?.label}</small></td><td>{item.author||t("feedback.closedAccount")}<small>{item.email}</small></td><td><span className={`feedback-status is-${item.status}`}>{catalog.data?.statuses.find(o=>o.id===item.status)?.label??"—"}</span></td><td><time dateTime={item.createdAt}>{date(item.createdAt)}</time></td><td><button type="button" onClick={()=>setSelected(item.id)}>{t("feedback.view")}</button></td></tr>)}</tbody></table></div>
 {!list.data.items.length&&<p className="feedback-empty">{t("feedback.empty")}</p>}
 <footer className="feedback-pagination"><span>{t("feedback.pagination",{page,count:list.data.total})}</span><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>{t("feedback.previous")}</button><button disabled={page*list.data.pageSize>=list.data.total} onClick={()=>setPage(p=>p+1)}>{t("feedback.next")}</button></footer></>}
 {catalog.isError&&<p role="alert">{t("feedback.loadError")}</p>}
 {selected&&<FeedbackReview key={selected} id={selected} userId={userId} locale={locale} catalog={catalog.data} onClose={()=>setSelected(undefined)}/>}
 </main>;
}
function FeedbackReview({id,userId,locale,catalog,onClose}:{id:string;userId:string;locale:SupportedLocale;catalog?:FeedbackCatalog;onClose:()=>void}) {
 const {t}=useTranslation();const data=useQuery({queryKey:["admin-feedback-detail",userId,id],queryFn:()=>feedbackService.detail(id),refetchOnWindowFocus:false,refetchOnReconnect:false});
 return data.data?<FeedbackEditor key={data.data.item.id} data={data.data} userId={userId} locale={locale} catalog={catalog} onClose={onClose}/>:<NoticeModal title={t("feedback.view")} onClose={onClose}><p role={data.isError?"alert":"status"}>{data.isError?localizedApiError(data.error,t):t("common.loading")}</p>{data.isError&&<button onClick={()=>void data.refetch()}>{t("feedback.retry")}</button>}</NoticeModal>;
}
function FeedbackEditor({data:initialData,userId,locale,catalog,onClose}:{data:FeedbackDetail;userId:string;locale:SupportedLocale;catalog?:FeedbackCatalog;onClose:()=>void}) {
 const {t}=useTranslation(),client=useQueryClient();const [data,setData]=useState(initialData);const [status,setStatus]=useState(initialData.item.status),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[uncertain,setUncertain]=useState(false);
 const {markDirty,requestClose}=useUnsavedClose(onClose,t("common.unsavedConfirm"),busy);
 const save=async(e:FormEvent)=>{e.preventDefault();if(busy||uncertain)return;setBusy(true);setError("");try{await feedbackService.update(data.item.id,{version:data.item.version,status,reply});void client.invalidateQueries({queryKey:["admin-feedback",userId]});void client.invalidateQueries({queryKey:["admin-feedback-detail",userId,data.item.id]});showAdminToast(t("feedback.saved"));onClose();}catch(e){setError(localizedApiError(e,t));setUncertain(true);}finally{setBusy(false);}};
 const refresh=async()=>{if(busy)return;setBusy(true);setError("");try{
  const latest=await client.fetchQuery({queryKey:["admin-feedback-detail",userId,data.item.id],queryFn:()=>feedbackService.detail(data.item.id),staleTime:0,retry:false});
  const delivered=!!reply.trim()&&latest.responses.some(r=>r.body===reply.trim()&&r.status===status&&!data.responses.some(old=>old.body===r.body&&old.createdAt===r.createdAt&&old.author===r.author));
  setData(latest);if(latest.item.version!==data.item.version)setStatus(latest.item.status);if(delivered){setReply("");showAdminToast(t("feedback.saved"));}
  setUncertain(false);void client.invalidateQueries({queryKey:["admin-feedback",userId]});
 }catch(e){setError(localizedApiError(e,t));}finally{setBusy(false);}};
 return <NoticeModal title={t("feedback.view")} onClose={()=>void requestClose()}><div className="feedback-review">
 <div className="feedback-review-meta"><strong>{data.item.author||t("feedback.closedAccount")}</strong><span>{data.item.email}</span><time>{new Date(data.item.createdAt).toLocaleString(locale)}</time></div>
 <p className="feedback-original">{data.item.description}</p><small className="feedback-page-path">{t("feedback.page")}: {data.item.pagePath}</small>
 {data.item.hasScreenshot&&<a href={`/api/admin/feedback/${encodeURIComponent(data.item.id)}/screenshot`} target="_blank" rel="noreferrer"><img className="feedback-screenshot" src={`/api/admin/feedback/${encodeURIComponent(data.item.id)}/screenshot`} alt={t("feedback.screenshot")}/></a>}
 <form onSubmit={e=>void save(e)}><label>{t("feedback.status")}<select aria-label={t("feedback.status")} disabled={busy||uncertain||!catalog} value={status} onChange={e=>{setStatus(e.target.value);markDirty();}}>{catalog?.statuses.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
 <label>{t("feedback.reply")}<textarea aria-label={t("feedback.reply")} rows={4} maxLength={4000} disabled={busy||uncertain} value={reply} placeholder={t("feedback.replyPlaceholder")} onChange={e=>{setReply(e.target.value);markDirty();}}/></label>
 {error&&<p role="alert">{error}</p>}{uncertain&&<button type="button" disabled={busy} onClick={()=>void refresh()}>{t("feedback.refresh")}</button>}
 <footer><button type="button" disabled={busy} onClick={()=>void requestClose()}>{t("common.cancel")}</button><button type="submit" disabled={busy||uncertain||!catalog||(!reply.trim()&&status===data.item.status)}>{t(busy?"feedback.sending":reply.trim()?"feedback.sendReply":"feedback.saveStatus")}</button></footer></form>
 {!!data.responses.length&&<details><summary>{t("feedback.replyHistory")} ({data.responses.length})</summary>{data.responses.map((r,i)=><article key={i}><small>{r.author||t("feedback.closedAccount")} · {new Date(r.createdAt).toLocaleString(locale)}</small><p className="feedback-original">{r.body}</p></article>)}</details>}
 </div></NoticeModal>;
}
