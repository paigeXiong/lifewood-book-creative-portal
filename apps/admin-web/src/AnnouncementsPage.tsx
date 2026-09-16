import { HelpPopover } from "@lifewood/ui/help-popover";
import { useEffect, useRef, useState } from "react";
import { closeNoticeDraft, readNoticeDraft, writeNoticeDraft, type NoticeEditor } from "./announcement-draft";
import { useInfiniteQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, announcementService, localizedApiError } from "@lifewood/api-client";
import type { AnnouncementDocument, AnnouncementInput, SupportedLocale } from "@lifewood/domain";
import { SettingsTabs } from "./SettingsTabs";
import { ModalFrame } from "./ModalFrame";
import { useConfirm } from "./useConfirm";
import { useAnnouncementActions } from "./useAnnouncementActions";
import { maxNoticePages, noticeListSearch, readNoticeListState } from "./announcement-list-state";
import "./announcements.css";
const noticeTitle=(content:AnnouncementInput,locale:SupportedLocale)=>content.title ?? (locale==="en-US"?content.titleEn:content.titleZh) ?? "";
const noticeBody=(content:AnnouncementInput,locale:SupportedLocale)=>content.body ?? (locale==="en-US"?content.bodyEn:content.bodyZh) ?? "";
const empty = (userId: string): NoticeEditor => ({id:crypto.randomUUID().replaceAll("-",""),flowId:crypto.randomUUID(),userId,organizations:{},content:{title:"",body:"",placement:"personal",audience:"all",languages:[],organizationIds:[],displayDays:30,startsAt:null,endsAt:null,version:0}});
export function AnnouncementsPage({locale,userId}:{locale:SupportedLocale;userId:string}) {
 const {t}=useTranslation();const confirm=useConfirm();const client=useQueryClient();const navigate=useNavigate();const location=useLocation();
 const [localEditor,setLocalEditor]=useState<{key:string;editor:NoticeEditor|undefined}>(()=>({key:location.key,editor:readNoticeDraft(location.state,userId)}));
 const candidate=localEditor.key===location.key?localEditor.editor:readNoticeDraft(location.state,userId);
 const editor=readNoticeDraft({announcementEditor:candidate},userId);
 const editorRef=useRef(editor);editorRef.current=editor;
 const alive=useRef(false),asking=useRef(false),saving=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const setEditor=(value:NoticeEditor|undefined|((previous:NoticeEditor|undefined)=>NoticeEditor|undefined))=>{
   const next=typeof value==="function"?value(editorRef.current):value;
   const opening=!!next && next.flowId!==editorRef.current?.flowId;
   editorRef.current=next;
   if(next)writeNoticeDraft(next);
   setLocalEditor({key:location.key,editor:next});
   if(opening||!next)navigate(location.pathname+location.search+location.hash,{replace:true,flushSync:true,state:{...location.state,announcementEditor:next,announcementSelection:undefined}});
 };
 const [preview,setPreview]=useState(false);
 const filters=readNoticeListState(location.search),{search,status,placement,pages}=filters;
 const loadingMore=useRef(false);
 const locationRef=useRef({key:location.key,generation:0});
 if(locationRef.current.key!==location.key){locationRef.current={key:location.key,generation:locationRef.current.generation+1};loadingMore.current=false;}
 const setFilters=(patch:Partial<typeof filters>)=>navigate(location.pathname+noticeListSearch({...filters,pages:1,...patch}),{state:location.state,flushSync:true});
 useEffect(()=>{if(!editor)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);},[!!editor]);
 const list=useInfiniteQuery({queryKey:["admin-announcements",userId,search,status,placement],initialPageParam:undefined as number|undefined,queryFn:({pageParam})=>announcementService.list(search,pageParam,status,placement),getNextPageParam:p=>p.nextCursor??undefined});
 const loaded=list.data?.pages.length??0;
 useEffect(()=>{if(loaded>0&&loaded<pages&&list.hasNextPage&&!list.isFetching&&!list.error)void list.fetchNextPage();},[loaded,pages,list.hasNextPage,list.isFetching,list.error,list.fetchNextPage]);
 const loadMore=async()=>{
   if(loadingMore.current||list.isFetching||pages>=maxNoticePages)return;
   loadingMore.current=true;const generation=locationRef.current.generation;
   try {
     if(loaded<=pages){const result=await list.fetchNextPage();if(result.isError||(result.data?.pages.length??0)<=pages)return;}
     if(alive.current&&locationRef.current.generation===generation)setFilters({pages:pages+1});
   }finally{if(locationRef.current.generation===generation)loadingMore.current=false;}
 };
 const save=useMutation({mutationKey:["admin-announcement-save",userId],mutationFn:(e:NoticeEditor)=>announcementService.save(e.id,{...e.content,displayDays:e.content.displayDays??30,startsAt:null,endsAt:null}),onError:(error,failed)=>{
   if(error instanceof ApiError && error.details.code==="announcement.conflict") {
     const current=readNoticeDraft({announcementEditor:failed},userId);
     if(current){const retained={...current,saveConflict:true};writeNoticeDraft(retained);if(alive.current && editorRef.current?.flowId===failed.flowId)setEditor(retained);}
     void client.invalidateQueries({queryKey:["admin-announcements"]});
   }
 },onSuccess:(_data,saved)=>{closeNoticeDraft(saved);if(alive.current && editorRef.current?.flowId===saved.flowId)setEditor(undefined);void client.invalidateQueries({queryKey:["admin-announcements"]});}});
 const saves=useMutationState({filters:{mutationKey:["admin-announcement-save",userId]},select:mutation=>({editor:mutation.state.variables as NoticeEditor|undefined,status:mutation.state.status,error:mutation.state.error})});
 const currentSave=saves.filter(item=>item.editor?.flowId===editor?.flowId).at(-1);
 const savePending=save.isPending||currentSave?.status==="pending";
 const saveError=currentSave?.error??save.error;
 const saveConflict=editor?.saveConflict===true || saveError instanceof ApiError && saveError.details.code==="announcement.conflict";
 const canRetry=saveError instanceof ApiError && saveError.details.retryable;
 saving.current=savePending;
 const actions=useAnnouncementActions(userId,locale,()=>client.invalidateQueries({queryKey:["admin-announcements"]},{throwOnError:true}));
 const busy=actions.busy||list.isFetching||!!list.error||actions.refreshFailed;
 const update=(patch:Partial<AnnouncementInput>)=>setEditor(e=>e?{...e,content:{...e.content,...("title" in patch||"body" in patch?{title:noticeTitle(e.content,locale),body:noticeBody(e.content,locale)}:{}),...patch}}:e);
 const recoverAsNew=async()=>{
   const original=editorRef.current;if(!original||saving.current||asking.current)return;
   asking.current=true;
   try {
     if(!await confirm(t("announcements.recoveryCopyConfirm"),false)||!alive.current||saving.current||editorRef.current?.flowId!==original.flowId)return;
     const current=editorRef.current;
     const next={...current,id:crypto.randomUUID().replaceAll("-",""),flowId:crypto.randomUUID(),saveConflict:false,content:{...current.content,version:0,startsAt:null,endsAt:null}};
     setEditor(next);closeNoticeDraft(current);save.reset();
   } catch { /* Retain the original draft if confirmation cannot complete. */ }
   finally {asking.current=false;}
 };
 const open=(d?:AnnouncementDocument)=>{save.reset();setPreview(false);setEditor(d?{listSearch:noticeListSearch(filters),flowId:crypto.randomUUID(),userId,id:d.status==="draft"?d.id:crypto.randomUUID().replaceAll("-",""),content:{...d.content,displayDays:d.content.displayDays??30,...(d.status==="draft"?{}:{title:noticeTitle(d.content,locale),body:noticeBody(d.content,locale)}),version:d.status==="draft"?d.version:0,startsAt:d.status==="draft"?d.content.startsAt:null,endsAt:d.status==="draft"?d.content.endsAt:null},organizations:{}}:{...empty(userId),listSearch:noticeListSearch(filters)});};
 const close=async()=>{const current=editorRef.current;if(!current||saving.current||asking.current)return;asking.current=true;try{if(await confirm(t("announcements.unsaved"),false)&&alive.current&&!saving.current&&editorRef.current?.flowId===current.flowId){closeNoticeDraft(current);setEditor(undefined);}}catch{/* Keep the draft if confirmation cannot complete. */}finally{asking.current=false;}};
 const error=saveError??list.error;
 return <main className="content announcement-admin"><SettingsTabs locale={locale}/>
 <section className="page-toolbar"><form role="search" onSubmit={e=>{e.preventDefault();setFilters({search:String(new FormData(e.currentTarget).get("q")??"").trim().slice(0,160)});}}><input key={location.key} name="q" type="search" maxLength={160} aria-label={t("announcements.search")} placeholder={t("announcements.search")} defaultValue={search}/><button>{t("common.search")}</button></form><select aria-label={t("announcements.status")} value={status} onChange={e=>setFilters({status:e.target.value})}><option value="">{t("announcements.allStatuses")}</option>{["draft","published","withdrawn"].map(value=><option key={value} value={value}>{t(`announcements.${value}`)}</option>)}</select><select aria-label={t("announcements.placement")} value={placement} onChange={e=>setFilters({placement:e.target.value})}><option value="">{t("announcements.allPlacements")}</option>{["login","personal"].map(value=><option key={value} value={value}>{t(`announcements.${value}`)}</option>)}</select><button disabled={actions.busy} onClick={()=>void actions.refresh()}>{t("announcements.refresh")}</button><button className="primary push-right" disabled={actions.busy} onClick={()=>open()}>{t("announcements.new")}</button></section>
 {actions.failure && !editor && <div role="alert" className="message error"><strong>{t(actions.failure.action==="delete"?"announcements.deleteDraft":`announcements.${actions.failure.action}`)} · {actions.failure.title}</strong><p>{t(`announcements.${actions.failure.hint}`)}</p>{!["actionConflict","actionMissing"].includes(actions.failure.hint)&&<p>{localizedApiError(actions.failure.cause,t)}</p>}</div>}
 {actions.refreshFailed&&!editor&&<p role="alert" className="message error">{t("announcements.actionRefreshFailed")}</p>}
 {error && !editor && <div role="alert" className="message error">{localizedApiError(error,t)}</div>}
 <section className="table-card"><div className="management-table-scroll"><table><thead><tr><th>{t("announcements.title")}</th><th>{t("announcements.audience")}</th><th>{t("announcements.status")}</th><th>{t("announcements.recipients")}</th><th>{t("announcements.actions")}</th></tr></thead><tbody>
 {list.data?.pages.slice(0,pages).flatMap(p=>p.items).map(d=><tr key={d.id}><td data-label={t("announcements.title")}><strong>{noticeTitle(d.content,locale)}</strong><small>{t(`announcements.${d.content.placement}`)}</small></td><td data-label={t("announcements.audience")}>{t(`announcements.${d.content.audience}`)}<small>{d.content.languages.join(" · ")}{d.content.organizationIds.length>0?` · ${t("announcements.organizations")} (${d.content.organizationIds.length})`:""}</small></td><td data-label={t("announcements.status")}>{t(`announcements.${d.status}`)}</td><td data-label={t("announcements.recipients")}>{d.content.placement==="personal"?d.recipients:"—"}</td><td data-label={t("announcements.actions")}><div className="notice-actions"><button disabled={busy} onClick={()=>open(d)}>{t(d.status==="draft"?"announcements.edit":"announcements.copy")}</button>{d.status!=="withdrawn"&&<button disabled={busy} onClick={()=>void actions.run(d,d.status==="draft"?"publish":"withdraw")}>{t(d.status==="draft"?"announcements.publish":"announcements.withdraw")}</button>}{d.status==="draft"&&<button className="danger" disabled={busy} onClick={()=>void actions.run(d,"delete")}>{t("announcements.deleteDraft")}</button>}</div></td></tr>)}
 </tbody></table>{list.isPending&&<p role="status">{t("announcements.loading")}</p>}{list.data?.pages[0].items.length===0&&<p className="empty">{t("announcements.empty")}</p>}</div>{(loaded>pages||list.hasNextPage)&&pages<maxNoticePages&&<button disabled={busy||loaded<pages} onClick={()=>void loadMore()}>{t("announcements.more")}</button>}{loaded<pages&&list.isFetching&&<p role="status">{t("announcements.loading")}</p>}{pages>=maxNoticePages&&(loaded>pages||list.hasNextPage)&&<p>{t("announcements.listLimit")}</p>}</section>
 {editor&&<ModalFrame labelledBy="notice-editor-title" className="notice-editor" busy={savePending} onClose={()=>void close()}><form onSubmit={e=>{e.preventDefault();if(!saving.current&&!saveConflict){saving.current=true;save.mutate(editorRef.current!);}}}><h2 id="notice-editor-title">{t("announcements.edit")}</h2>
 <fieldset disabled={savePending} className="notice-form"><div className="notice-pair"><label>{t("announcements.placement")}<select value={editor.content.placement} onChange={e=>update({placement:e.target.value as "login"|"personal",organizationIds:[],audience:"all",languages:[]})}><option value="personal">{t("announcements.personal")}</option><option value="login">{t("announcements.login")}</option></select></label><label>{t("announcements.audience")}<select value={editor.content.audience} onChange={e=>update({audience:e.target.value as "all"|"specified",languages:[],organizationIds:[]})}><option value="all">{t("announcements.all")}</option><option value="specified">{t("announcements.specified")}</option></select></label></div>
 <HelpPopover label={t("announcements.audience")}>{t(editor.content.placement==="login"?"announcements.publicHint":"announcements.snapshotHint")}</HelpPopover>
 {editor.content.audience==="specified"&&<section className="notice-target"><div className="field-help-heading"><strong>{t("announcements.languages")}</strong><HelpPopover label={t("announcements.languages")}>{t("announcements.scopeHint")}</HelpPopover></div><div className="notice-actions">{["zh-CN","en-US"].map(l=><label key={l}><input type="checkbox" checked={editor.content.languages.includes(l)} onChange={e=>update({languages:e.target.checked?[...editor.content.languages,l]:editor.content.languages.filter(x=>x!==l)})}/>{l==="zh-CN"?"简体中文":"English"}</label>)}</div>{editor.content.placement==="personal"&&<><strong>{t("announcements.organizations")}</strong><p>{editor.content.organizationIds.map(id=>editor.organizations[id]).filter(Boolean).join(" · ") || (editor.content.organizationIds.length ? `${t("announcements.selected")} · ${editor.content.organizationIds.length}` : "")||t("announcements.noSelection")}</p><div className="notice-actions"><button type="button" onClick={()=>navigate(`/${locale}/organizations?pick=announcement`,{state:{announcementEditor:editor}})}>{t("announcements.chooseOrgs")}</button><button type="button" onClick={()=>update({organizationIds:[]})}>{t("announcements.clear")}</button></div></>}</section>}
 <section className="notice-copy-fields"><label>{t("announcements.contentTitle")}<input required maxLength={160} value={noticeTitle(editor.content,locale)} onChange={e=>update({title:e.target.value})}/></label><label>{t("announcements.contentBody")}<textarea required maxLength={12000} rows={8} value={noticeBody(editor.content,locale)} onChange={e=>update({body:e.target.value})}/></label><HelpPopover label={t("announcements.contentBody")}><p>{t("announcements.singleContentHint")}</p>{editor.content.titleZh != null && editor.content.titleEn != null && <p>{t("announcements.legacyContentHint")}</p>}</HelpPopover></section>
 <div className="field-help-heading"><label className="notice-duration">{t("announcements.displayDays")}<input type="number" inputMode="numeric" required min={1} max={3650} step={1} value={editor.content.displayDays??""} onChange={e=>update({displayDays:e.target.value===""?null:Number(e.target.value)})}/></label><HelpPopover label={t("announcements.displayDays")}>{t("announcements.displayDaysHint")}</HelpPopover></div>
 </fieldset>{saveConflict?<div role="alert" className="message error"><p>{t("announcements.recoveryConflict")}</p><div className="notice-actions"><Link to={`/${locale}/settings/announcements`} target="_blank" rel="noopener noreferrer">{t("announcements.recoveryReview")}</Link><button type="button" disabled={savePending} onClick={()=>void recoverAsNew()}>{t("announcements.recoveryCopy")}</button></div></div>:saveError&&<div role="alert" className="message error"><p>{localizedApiError(saveError,t)}</p>{canRetry&&<p>{t("announcements.recoveryRetryHint")}</p>}</div>}
 <div className="notice-actions"><button type="button" disabled={savePending} onClick={()=>setPreview(!preview)}>{t("announcements.preview")}</button><button type="button" disabled={savePending} onClick={()=>void close()}>{t("announcements.cancel")}</button><button className="primary" disabled={savePending||saveConflict}>{t(savePending?"announcements.loading":canRetry?"announcements.recoveryRetry":"announcements.save")}</button></div>
 {preview&&<article className="notice-preview"><h3>{noticeTitle(editor.content,locale)}</h3><p>{noticeBody(editor.content,locale)}</p></article>}
 </form></ModalFrame>}</main>;
}
