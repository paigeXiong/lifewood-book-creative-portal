import { HelpPopover } from "@lifewood/ui/help-popover";
import {containDialogTab} from "./dialog-keyboard";
import {useNotificationDragSelection} from "./useNotificationDragSelection";
import {useNotificationLongPress} from "./useNotificationLongPress";
import {emptyNotificationFilters,maxNotificationPages,notificationDate,notificationSearch,useNotificationListState} from "./notification-list-state";
import {useNotificationActions} from "./useNotificationActions";
import {useEffect,useId,useRef,useState,type ButtonHTMLAttributes} from "react";
import {useInfiniteQuery,useMutation,useMutationState,useQuery,useQueryClient} from "@tanstack/react-query";
import {useNavigate,useParams,useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {captureAccountGuard,feedbackService,authService,notificationService as service,localizedApiError,type NotificationItem,type NotificationPreferences} from "@lifewood/api-client";
import type {SupportedLocale} from "@lifewood/domain";
import {showConfirmation} from "./confirmation";
import "./notifications.css";

const actionPaths = {
 select: "M4 4h6v6H4zM14 5h6M14 9h6M4 14h6v6H4zM14 15h6M14 19h6",
 preferences: "M4 7h16M4 17h16M8 4v6M16 14v6",
 center: "M14 4h6v6M20 4 11 13M10 5H5v14h14v-5",
 readAll: "m3 12 4 4 8-8m-3 8 8-8",
 read: "m5 12 4 4L19 6",
 unread: "M4 6h16v12H4zM4 7l8 6 8-6",
 archive: "M4 4h16v4H4zM6 8v12h12V8M10 12h4",
 restore: "M4 4h16v4H4zM6 8v12h12V8m-9 7 3-3 3 3M12 12v6",
 refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
 more: "m6 9 6 6 6-6",
 close: "m6 6 12 12M18 6 6 18",
 save: "M5 4h12l3 3v13H4V4h1M8 4v6h8V4M8 20v-7h8v7",
 details: "M12 11v6M12 7v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};
function NoticeAction({label,icon,className,...props}:{label:string;icon:keyof typeof actionPaths}&ButtonHTMLAttributes<HTMLButtonElement>){return <button type="button" {...props} className={["notification-icon-action",className].filter(Boolean).join(" ")} data-icon-motion={icon === "refresh" ? "refresh" : "press"} aria-label={label} title={label}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={actionPaths[icon]}/></svg></button>;}
const useAccount=(admin=false)=>useQuery({queryKey:[admin?"admin-me":"current-user"],queryFn:authService.getCurrentUser});
function useNoticeContext(admin=false){const {locale:raw}=useParams();const locale:SupportedLocale=raw==="en-US"?"en-US":"zh-CN";const account=useAccount(admin);return {locale,user:account.data?.id??""};}
export function NotificationBell({admin=false}:{admin?:boolean}){
 const {locale,user}=useNoticeContext(admin);const {t}=useTranslation();const client=useQueryClient();const location=useLocation();const [open,setOpen]=useState(false);const [toast,setToast]=useState(false);const dialog=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLButtonElement>(null);const seen=useRef<number|undefined>(undefined);
 const count=useQuery({queryKey:["notifications",user,"count"],queryFn:service.counts,enabled:!!user,refetchInterval:30000});
 const catalog=useQuery({queryKey:["notification-catalog"],queryFn:service.catalog,enabled:!!user,refetchInterval:30000});
 const preferences=useQuery({queryKey:["notification-preferences",user],queryFn:service.preferences,enabled:!!user});
 useEffect(()=>{if(!user)return;seen.current=undefined;const stream=new EventSource(`/api/notifications/stream?account=${encodeURIComponent(user)}`);stream.onmessage=e=>{try{const value=JSON.parse(e.data) as {unread:number;watermark:number};client.setQueryData(["notifications",user,"count"],value);void client.invalidateQueries({queryKey:["notifications",user,"feed"]});}catch{}};const stop=()=>stream.close();window.addEventListener("lw-account-changed",stop);return()=>{stream.close();window.removeEventListener("lw-account-changed",stop);};},[user,client]);
 useEffect(()=>{const watermark=count.data?.watermark;if(watermark===undefined)return;const previous=seen.current;seen.current=watermark;if(previous===undefined||watermark<=previous||!preferences.data)return;
  const p=preferences.data;if(!p.toast||document.visibilityState!=="visible")return;
  const time=new Intl.DateTimeFormat("en-GB",{timeZone:p.timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
  if(p.quietStart&&p.quietEnd&&(p.quietStart<p.quietEnd?time>=p.quietStart&&time<p.quietEnd:time>=p.quietStart||time<p.quietEnd))return;
  let active=true;void service.list(locale,{unread:"true"}).then(page=>{if(!active)return;const fresh=page.items.filter(n=>n.id>previous&&!(p.mutedKinds?.includes(n.kind)&&catalog.data?.items.find(r=>r.kind===n.kind)?.allowMute)&&(!n.projectId||(!location.pathname.includes(n.projectId)&&!location.search.includes(n.projectId))));if(!fresh.length)return;try{const key=`lw-notification-alert:${user}`;const last=Number(localStorage.getItem(key)??0);if(last>=watermark)return;localStorage.setItem(key,String(watermark));}catch{}setToast(true);if(p.sound){try{const audio=new AudioContext();const oscillator=audio.createOscillator();const gain=audio.createGain();gain.gain.value=.04;oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.12);oscillator.onended=()=>void audio.close();}catch{}}}).catch(()=>{});return()=>{active=false;};
 },[count.data?.watermark,preferences.data,catalog.data,locale,location.pathname,location.search,user]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(false),6000);return()=>clearTimeout(timer);},[toast]);
 useEffect(()=>{if(open){dialog.current?.showModal();}else if(dialog.current?.open){dialog.current.close();trigger.current?.focus();}},[open]);
 return <><button ref={trigger} type="button" className="notification-bell" data-icon-motion="ring" title={t("notifications.entry",{count:count.data?.unread??0})} aria-label={t("notifications.entry",{count:count.data?.unread??0})} onClick={()=>{setToast(false);setOpen(true);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> {!!count.data?.unread&&<b>{count.data.unread>99?"99+":count.data.unread}</b>}</button>
 {toast&&<div className="notification-toast" role="status"><button onClick={()=>{setToast(false);setOpen(true);}}>{t("notifications.newArrivals")}</button><button aria-label={t("common.close")} onClick={()=>setToast(false)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>}
 <dialog ref={dialog} onKeyDown={containDialogTab} className="notification-dialog notification-quick-dialog" aria-label={t("notifications.title")} onCancel={()=>setOpen(false)}><header><strong>{t("notifications.title")}</strong><NoticeAction label={t("common.close")} icon="close" onClick={()=>setOpen(false)}/></header>{open&&<NotificationCenter compact admin={admin} onNavigate={()=>setOpen(false)}/>}</dialog></>;
}
export function NotificationCenter({compact=false,admin=false,onNavigate}:{compact?:boolean;admin?:boolean;onNavigate?:()=>void}){
 const {locale,user}=useNoticeContext(admin);const {t}=useTranslation();const client=useQueryClient();const navigate=useNavigate();const confirmationLabels={title:t("common.confirmTitle"),confirm:t("common.confirmAction"),cancel:t("common.cancel")};
 const history=useNotificationListState(compact,user);const {search,kind,state,unread,archived,project,from,to,pages}=history.value;
 const [selected,setSelected]=useState<number[]>([]);const [selecting,setSelecting]=useState(false);const [prefs,setPrefs]=useState(false);const [detail,setDetail]=useState<NotificationItem>();const [linkError,setLinkError]=useState<unknown>();
 useEffect(()=>{setDetail(undefined);setPrefs(false);},[user]);
 const location=useLocation();
 const linkRequest=useRef<AbortController|null>(null),[linkPending,setLinkPending]=useState(false);
 useEffect(()=>{
  setLinkPending(false);setLinkError(undefined);
  return()=>{linkRequest.current?.abort();linkRequest.current=null;};
 },[user,locale,admin,location.key,detail?.id]);
 useEffect(()=>{
  const stop=()=>{linkRequest.current?.abort();linkRequest.current=null;setLinkPending(false);setLinkError(undefined);setDetail(undefined);setPrefs(false);};
  window.addEventListener("lw-account-changed",stop);
  return()=>window.removeEventListener("lw-account-changed",stop);
 },[]);
 const selectionRoot=useRef<HTMLElement>(null), restoreSelectionFocus=useRef(false);
 const dateErrorId=useId();const currentUser=useRef(user);currentUser.current=user;
 const {search:appliedSearch,project:appliedProject}=history.committed;
 const fromIso=notificationDate(from),toIso=notificationDate(to,true);
 const invalidDates=fromIso===null||toIso===null||Boolean(from&&to&&from>to);
 const filtering=search.trim()!==appliedSearch||project.trim()!==appliedProject;
 const hasFilters=Boolean(search.trim()||kind||state||unread||archived||project.trim()||from||to);
 const clearFilters=()=>history.setFilters(emptyNotificationFilters);
 const catalog=useQuery({queryKey:["notification-catalog"],queryFn:service.catalog});
 const filters={search:appliedSearch,kind,state,project:appliedProject,from:fromIso??"",to:toIso??"",unread:String(unread),archived:String(archived)};
 const feed=useInfiniteQuery({queryKey:["notifications",user,"feed",locale,filters],queryFn:({pageParam})=>service.list(locale,filters,pageParam),initialPageParam:undefined as number|undefined,getNextPageParam:p=>p.nextCursor??undefined,enabled:!!user&&!invalidDates&&!filtering,refetchInterval:30000});
 useEffect(()=>{hold.cancel();drag.cancel();setSelected([]);setSelecting(false);update.reset();},[search,kind,state,project,from,to,unread,archived,user]);
 const update=useNotificationActions(user,JSON.stringify([locale,admin,location.key,search,kind,state,project,from,to,unread,archived]),()=>{if(selecting)restoreSelectionFocus.current=true;setSelected([]);setSelecting(false);});
 const actionsBusy=update.isPending||linkPending;
 const loaded=feed.data?.pages.length??0;
 const moreRequest=useRef<object|null>(null);
 useEffect(()=>{if(!invalidDates&&!filtering&&loaded>0&&loaded<pages&&feed.hasNextPage&&!feed.isFetching&&!feed.error)void feed.fetchNextPage();},[invalidDates,filtering,loaded,pages,feed.hasNextPage,feed.isFetching,feed.error,feed.fetchNextPage]);
 const loadMore=async()=>{
  if(moreRequest.current===history.token||feed.isFetching||loaded<pages||invalidDates||filtering||actionsBusy||pages>=maxNotificationPages)return;
  const token=history.token;moreRequest.current=token;
  try{
   if(loaded<=pages){const result=await feed.fetchNextPage();if(result.isError||(result.data?.pages.length??0)<=pages)return;}
   if(history.isCurrent(token))history.setFilters({pages:pages+1});
  }finally{if(moreRequest.current===token)moreRequest.current=null;}
 };

 const items=invalidDates||filtering?[]:feed.data?.pages.slice(0,pages).flatMap(p=>p.items)??[];
 const leaveSelection=()=>{hold.cancel();drag.cancel();update.reset();restoreSelectionFocus.current=true;setSelected([]);setSelecting(false);};
 const toggleSelection=(id:number)=>{if(!actionsBusy)setSelected(current=>current.includes(id)?current.filter(value=>value!==id):current.length<500?[...current,id]:current);};
 const hold=useNotificationLongPress(id=>{setSelecting(true);setSelected([id]);},selecting||actionsBusy);
 const drag=useNotificationDragSelection({root:selectionRoot,ids:items.map(item=>item.id),selected,disabled:!selecting||actionsBusy||prefs||!!detail,onSelect:setSelected});
 useEffect(()=>{if(feed.data){const visible=new Set(feed.data.pages.slice(0,pages).flatMap(page=>page.items.map(item=>item.id)));setSelected(current=>current.filter(id=>visible.has(id)));}},[feed.data,pages]);

 useEffect(()=>{if(actionsBusy)return;if(selecting)(selectionRoot.current?.querySelector<HTMLInputElement>(".notification-list input:checked")??selectionRoot.current?.querySelector<HTMLInputElement>(".notification-list input[type=checkbox]"))?.focus({preventScroll:true});else if(restoreSelectionFocus.current){restoreSelectionFocus.current=false;selectionRoot.current?.querySelector<HTMLButtonElement>(".notification-enter-selection")?.focus({preventScroll:true});}},[selecting,actionsBusy]);
 const readEveryNotification=()=>{
  if(update.isBusy()||linkPending||invalidDates||filtering||!feed.data||feed.isError)return;
  const through=feed.data.pages[0].watermark;
  update.mutate({action:"read",through},signal=>showConfirmation(t("notifications.readAllConfirm"),confirmationLabels,signal,false));
 };
 const go=async(n?:NotificationItem)=>{
  if(linkRequest.current||update.isBusy()||!user)return;
  if(n?.kind==="feedback_reply"){setDetail(n);update.mutate({action:"read",ids:[n.id]});return;}
  const controller=new AbortController();linkRequest.current=controller;setLinkPending(true);setLinkError(undefined);
  const active=()=>!controller.signal.aborted&&linkRequest.current===controller&&currentUser.current===user;
  try{
   if(document.body.dataset.unsavedChanges==="true"&&!await showConfirmation(t("wizard.unsavedChanges"),confirmationLabels,controller.signal,false))return;
   if(!active())return;
   if(n){
    const target=await service.target(n.id,locale,admin,controller.signal);
    if(!active())return;
    await service.update("read",[n.id],undefined,controller.signal);
    if(!active())return;
    void client.invalidateQueries({queryKey:["notifications",user]});
    if(target.path===`/api/portals/backups?locale=${locale}`)window.location.assign(target.path);else navigate(target.path);
   }else navigate(`/${locale}/notifications${notificationSearch({...history.value,pages:1})}`);
   setDetail(undefined);onNavigate?.();
  }catch(error){if(active())setLinkError(error);}
  finally{if(linkRequest.current===controller){linkRequest.current=null;setLinkPending(false);}}
 };
 const linkFeedback=<>{linkPending&&<p role="status">{t("common.loading")}</p>}{linkError!=null&&<p role="alert">{localizedApiError(linkError,t)}</p>}</>;

 return <section ref={selectionRoot} className={compact?"notification-center compact":"notification-center content"} aria-label={t("notifications.title")} onKeyDownCapture={event=>{if(event.key==="Escape"&&selecting&&!detail&&!prefs){event.preventDefault();event.stopPropagation();if(!actionsBusy)leaveSelection();}}}>
 <div className="notification-toolbar notification-filters"><input disabled={actionsBusy} type="search" maxLength={160} value={search} placeholder={t("notifications.search")} aria-label={t("notifications.search")} onChange={e=>history.setFilters({search:e.target.value},true)}/><select disabled={actionsBusy} aria-label={t("notifications.type")} value={kind} onChange={e=>history.setFilters({kind:e.target.value})}><option value="">{t("notifications.allTypes")}</option>{catalog.data?.items.map(r=><option value={r.kind} key={r.kind}>{t(`notifications.kinds.${r.kind}`)}</option>)}</select><label><input disabled={actionsBusy} type="checkbox" checked={unread} onChange={e=>history.setFilters({unread:e.target.checked})}/>{t("notifications.unread")}</label><div className="notification-navigation-actions"><NoticeAction label={t("notifications.clearFilters")} icon="close" disabled={!hasFilters||actionsBusy} onClick={clearFilters}/>{!selecting&&<NoticeAction className="notification-enter-selection" label={t("notifications.enterSelection")} icon="select" disabled={!items.length||actionsBusy} onClick={()=>setSelecting(true)}/>}<NoticeAction label={t("notifications.refresh")} icon="refresh" disabled={feed.isFetching||invalidDates||filtering} onClick={()=>void feed.refetch()}/><NoticeAction label={t("notifications.preferences")} icon="preferences" onClick={()=>setPrefs(true)}/>{compact&&<NoticeAction label={t("notifications.center")} icon="center" disabled={actionsBusy} aria-busy={linkPending} onClick={()=>void go()}/>}</div></div>
 {!compact&&<div className="notification-toolbar"><select disabled={actionsBusy} aria-label={t("notifications.businessState")} value={state} onChange={e=>history.setFilters({state:e.target.value})}><option value="">{t("notifications.allStates")}</option>{["pending","done","info","expired"].map(s=><option key={s} value={s}>{t(`notifications.states.${s}`)}</option>)}</select><input disabled={actionsBusy} aria-label={t("notifications.project")} placeholder={t("notifications.project")} maxLength={160} value={project} onChange={e=>history.setFilters({project:e.target.value},true)}/><label>{t("notifications.from")}<input disabled={actionsBusy} type="date" aria-invalid={invalidDates||undefined} aria-describedby={invalidDates?dateErrorId:undefined} max={to||undefined} value={from} onChange={e=>history.setFilters({from:e.target.value})}/></label><label>{t("notifications.to")}<input disabled={actionsBusy} type="date" aria-invalid={invalidDates||undefined} aria-describedby={invalidDates?dateErrorId:undefined} min={from||undefined} value={to} onChange={e=>history.setFilters({to:e.target.value})}/></label><label><input disabled={actionsBusy} type="checkbox" checked={archived} onChange={e=>history.setFilters({archived:e.target.checked})}/>{t("notifications.archived")}</label></div>}
 {selecting&&<div className="notification-toolbar notification-bulk-actions" role="group" aria-label={t("notifications.selectionActions")}><span className="notification-selection-count" role="status">{t("notifications.selectedCount",{count:selected.length})}</span><NoticeAction label={t("notifications.readSelected")} icon="read" disabled={actionsBusy||!selected.length} onClick={()=>update.mutate({action:"read",ids:selected})}/><NoticeAction label={t(archived?"notifications.restore":"notifications.archive")} icon={archived?"restore":"archive"} disabled={actionsBusy||!selected.length} onClick={()=>update.mutate({action:archived?"restore":"archive",ids:selected})}/><NoticeAction label={t("notifications.readAll")} icon="readAll" disabled={actionsBusy||!feed.data||invalidDates||filtering} onClick={()=>void readEveryNotification()}/><NoticeAction label={t("notifications.exitSelection")} icon="close" disabled={actionsBusy} onClick={leaveSelection}/>{selected.length===500&&<small>{t("notifications.selectionLimit")}</small>}</div>}
 <div className="notification-results">
 {invalidDates&&<p id={dateErrorId} role="alert">{t("notifications.invalidDates")}</p>}
 {!invalidDates&&!filtering&&(feed.error!=null||(!detail&&update.error!=null))&&<p role="alert">{localizedApiError(feed.error??update.error,t)} <NoticeAction label={t("common.retry")} icon="refresh" disabled={actionsBusy} onClick={()=>feed.error?void feed.refetch():update.retry()}/></p>}{!detail&&linkFeedback}
 {invalidDates?null:filtering||feed.isPending?<p className="notification-empty" role="status">{t("common.loading")}</p>:feed.isError&&!items.length?null:!items.length?<p className="notification-empty">{t(hasFilters?"notifications.noResults":"notifications.empty")}</p>:<ul className="notification-list">{items.map(n=><li key={n.id} className={[n.read?"":"is-unread",selecting?"is-selecting":"",selected.includes(n.id)?"is-selected":""].filter(Boolean).join(" ")} onPointerDown={event=>hold.start(event,n.id)} onPointerMove={hold.move} onPointerUp={hold.cancel} onPointerCancel={hold.cancel} onPointerLeave={hold.cancel} onContextMenu={event=>{if(hold.wasActivated(n.id))event.preventDefault();}} onClick={event=>{if(hold.consumeClick(n.id)){event.preventDefault();return;}if(selecting&&!(event.target as Element).closest("button,input,a"))toggleSelection(n.id);}}>{selecting&&<input type="checkbox" aria-label={t("notifications.select",{title:n.title})} checked={selected.includes(n.id)} disabled={actionsBusy||selected.length>=500&&!selected.includes(n.id)} onPointerDown={event=>drag.start(event,n.id)} onChange={()=>toggleSelection(n.id)}/>}<div><div className="notification-heading"><h3 className="notification-title">{n.title}</h3><span className="notification-read-state">{t(n.read?"notifications.readStatus":"notifications.unreadStatus")}</span></div><p><span>{t(`notifications.levels.${n.level}`)}</span> · <span>{t(`notifications.states.${n.state}`)}</span>{n.actor?` · ${n.actor}`:""} · <time dateTime={n.createdAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(n.createdAt))}</time></p>{!selecting&&<div className="notification-row-actions"><NoticeAction label={t("notifications.details")} icon="details" disabled={actionsBusy} onClick={()=>{if(update.isBusy()||linkRequest.current)return;setDetail(n);update.mutate({action:"read",ids:[n.id]});}}/>{n.kind!=="feedback_reply"&&<NoticeAction label={t(n.kind.startsWith("backup_")?"notifications.openBackups":"notifications.openProject")} icon="center" disabled={actionsBusy} aria-busy={linkPending} onClick={()=>void go(n)}/>}<NoticeAction label={t(n.read?"notifications.markUnread":"notifications.markRead")} icon={n.read?"unread":"read"} disabled={actionsBusy} onClick={()=>update.mutate({action:n.read?"unread":"read",ids:[n.id]})}/></div>}</div></li>)}</ul>}
 {!invalidDates&&!filtering&&(loaded>pages||feed.hasNextPage)&&pages<maxNotificationPages&&<NoticeAction label={t("notifications.more")} icon="more" disabled={feed.isFetching||loaded<pages||actionsBusy} onClick={()=>void loadMore()}/>}
 {loaded<pages&&feed.isFetching&&<p role="status">{t("common.loading")}</p>}
 {pages>=maxNotificationPages&&(loaded>pages||feed.hasNextPage)&&<p>{t("notifications.listLimit")}</p>}
 </div>
 {detail&&<NoticeModal title={t("notifications.details")} onClose={()=>setDetail(undefined)}><h3>{detail.title}</h3><p>{detail.projectTitle}</p><p>{detail.actor?`${detail.actor} · `:""}{new Date(detail.createdAt).toLocaleString(locale)}</p><p>{t(`notifications.states.${detail.state}`)}</p>{linkFeedback}{update.error!=null&&<p role="alert">{localizedApiError(update.error,t)} <NoticeAction label={t("common.retry")} icon="refresh" disabled={actionsBusy} onClick={()=>{if(update.variables)update.retry();}}/></p>}{detail.kind==="feedback_reply"?<FeedbackNoticeContent id={detail.id} user={user} locale={locale}/>:<NoticeAction label={t(detail.kind.startsWith("backup_")?"notifications.openBackups":"notifications.openProject")} icon="center" disabled={actionsBusy} aria-busy={linkPending} onClick={()=>void go(detail)}/>}</NoticeModal>}
 {prefs&&<PreferenceEditor key={user} user={user} onClose={()=>setPrefs(false)}/>}
 </section>;
}
export function NoticeModal({title,onClose,children,closeDisabled=false}:{title:string;onClose:()=>void;children:React.ReactNode;closeDisabled?:boolean}){const {t}=useTranslation();const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(previous?.isConnected)previous.focus();};},[]);return <dialog ref={ref} onKeyDown={containDialogTab} className="notification-dialog" aria-label={title} onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();event.stopPropagation();if(!closeDisabled)onClose();}}><header><strong>{title}</strong><NoticeAction label={t("common.close")} icon="close" disabled={closeDisabled} onClick={onClose}/></header>{children}</dialog>;}
function PreferenceEditor({user,onClose}:{user:string;onClose:()=>void}){
 const {t}=useTranslation(), client=useQueryClient();
 const queryKey=["notification-preferences",user], mutationKey=["notification-preferences-save",user];
 const query=useQuery({queryKey,queryFn:service.preferences,retry:false});
 const catalog=useQuery({queryKey:["notification-catalog"],queryFn:service.catalog});
 const pending=useMutationState({filters:{mutationKey,status:"pending"},select:()=>true});
 const [draft,setDraft]=useState<NotificationPreferences>(), [error,setError]=useState<unknown>(), [invalidated,setInvalidated]=useState(false);
 type Lifetime={mounted:boolean;accountChanged:boolean};
 const lifetime=useRef<Lifetime|null>(null), lock=useRef(false);
 useEffect(()=>{
  const token={mounted:true,accountChanged:false};lifetime.current=token;
  const stop=()=>{token.accountChanged=true;setInvalidated(true);setError(undefined);setDraft(undefined);};
  window.addEventListener("lw-account-changed",stop);
  return()=>{token.mounted=false;lifetime.current=null;window.removeEventListener("lw-account-changed",stop);};
 },[]);
 const isSaving=()=>lock.current||client.getMutationCache().findAll({mutationKey,status:"pending"}).length>0;
 const save=useMutation({mutationKey,retry:false,networkMode:"always",mutationFn:async({value,token,guard}:{
  value:NotificationPreferences;token:Lifetime;guard:()=>void;
 })=>{
  const active=()=>lifetime.current===token&&token.mounted&&!token.accountChanged;
  try{
   if(!active())return;
   guard();
   const saved=await service.savePreferences(value);
   guard();if(token.accountChanged)return;
   // An older background read must not overwrite the acknowledged preferences.
   await client.cancelQueries({queryKey,exact:true});guard();if(token.accountChanged)return;
   client.setQueryData(queryKey,saved);
   if(active())onClose();
  }catch(reason){
   if(!token.accountChanged){
    try{guard();await client.invalidateQueries({queryKey,exact:true});}catch{/* The query exposes a read-only retry. */}
   }
   if(active())setError(reason);
  }finally{if(active())lock.current=false;}
 }});
 const value=draft??query.data, busy=pending.length>0;
 const disabled=busy||invalidated||query.fetchStatus!=="idle"||!query.isSuccess;
 const close=()=>{if(invalidated||!isSaving())onClose();};
 return <NoticeModal title={t("notifications.preferences")} onClose={close} closeDisabled={busy&&!invalidated}>
  {value?<form className="notification-form" aria-busy={busy} onSubmit={event=>{
   event.preventDefault();const token=lifetime.current;
   if(!token||token.accountChanged||disabled||isSaving()||!catalog.isSuccess||!catalog.data)return;
   const submitted={...value,mutedKinds:(value.mutedKinds??[]).filter(kind=>catalog.data.items.some(rule=>rule.kind===kind&&rule.allowMute)),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
   lock.current=true;setError(undefined);setDraft(submitted);
   save.mutate({value:submitted,token,guard:captureAccountGuard()});
  }}>
   <label><input disabled={disabled} type="checkbox" checked={value.toast} onChange={e=>setDraft({...value,toast:e.target.checked})}/>{t("notifications.toast")}</label>
   <label><input disabled={disabled} type="checkbox" checked={value.sound} onChange={e=>setDraft({...value,sound:e.target.checked})}/>{t("notifications.sound")}</label>
   <label>{t("notifications.quietStart")}<input disabled={disabled} type="time" required={!!value.quietEnd} value={value.quietStart??""} onChange={e=>setDraft({...value,quietStart:e.target.value||null})}/></label>
   <label>{t("notifications.quietEnd")}<input disabled={disabled} type="time" required={!!value.quietStart} value={value.quietEnd??""} onChange={e=>setDraft({...value,quietEnd:e.target.value||null})}/></label>
   <div className="field-help-heading"><span>{t("notifications.preferences")}</span><HelpPopover label={t("notifications.preferences")}>{t("notifications.muteHint")}</HelpPopover></div>
   {catalog.isPending&&<p role="status">{t("common.loading")}</p>}
   {catalog.error&&<p role="alert">{localizedApiError(catalog.error,t)} <NoticeAction label={t("common.retry")} icon="refresh" disabled={busy||invalidated||catalog.isFetching} onClick={()=>void catalog.refetch()}/></p>}
   {catalog.data?.items.filter(rule=>rule.allowMute).map(rule=><label key={rule.kind}><input disabled={disabled} type="checkbox" checked={value.mutedKinds?.includes(rule.kind)??false} onChange={e=>setDraft({...value,mutedKinds:e.target.checked?[...(value.mutedKinds??[]),rule.kind]:(value.mutedKinds??[]).filter(kind=>kind!==rule.kind)})}/>{t(`notifications.kinds.${rule.kind}`)}</label>)}
   {!invalidated&&error!=null&&<p role="alert">{localizedApiError(error,t)}</p>}
   {busy&&<p role="status">{t("common.loading")}</p>}
   <NoticeAction label={t("notifications.save")} icon="save" type="submit" disabled={disabled||!catalog.isSuccess}/>
  </form>:!query.error&&<p role="status">{t("common.loading")}</p>}
  {invalidated?<p role="alert">{t("accountSwitch.changed")}</p>:query.error&&<p role="alert">{localizedApiError(query.error,t)} <NoticeAction label={t("common.retry")} icon="refresh" disabled={busy||query.fetchStatus!=="idle"} onClick={()=>void query.refetch()}/></p>}
 </NoticeModal>;
}

function FeedbackNoticeContent({id,user,locale}:{id:number;user:string;locale:SupportedLocale}) {
 const {t}=useTranslation();const data=useQuery({queryKey:["feedback-notice",user,id],queryFn:()=>feedbackService.notice(id)});
 const catalog=useQuery({queryKey:["feedback-catalog",locale],queryFn:()=>feedbackService.catalog(locale)});
 if(data.isPending)return <p role="status">{t("common.loading")}</p>;
 if(data.isError)return <p role="alert">{localizedApiError(data.error,t)} <button onClick={()=>void data.refetch()}>{t("feedback.retry")}</button></p>;
 return <div className="feedback-notice-content"><h4>{t("feedback.original")}</h4><p>{data.data.description}</p><h4>{t("feedback.noticeReply")}</h4><p>{data.data.reply}</p><small>{t("feedback.status")}: {catalog.data?.statuses.find(s=>s.id===data.data.status)?.label??"—"}</small></div>;
}
