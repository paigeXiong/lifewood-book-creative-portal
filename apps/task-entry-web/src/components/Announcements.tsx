import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { announcementService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import "./announcements.css";
export function Announcements({locale,userId}:{locale:SupportedLocale;userId?:string}) {
 const {t}=useTranslation();const client=useQueryClient();
 const [mode,setMode]=useState<"new"|"history">("new");const [open,setOpen]=useState(false);const offered=useRef(false);
 const dialog=useRef<HTMLDialogElement>(null);const sentinel=useRef<HTMLDivElement>(null);
 const feed=useInfiniteQuery({queryKey:["announcements",userId??"public",locale,mode],initialPageParam:undefined as number|undefined,queryFn:({pageParam})=>announcementService.feed(locale,pageParam,mode==="new"&&!!userId,!userId),getNextPageParam:p=>p.nextCursor??undefined,refetchOnWindowFocus:false,refetchOnMount:"always",retry:1});
 const items=feed.data?.pages.flatMap(p=>p.items)??[];
 useEffect(()=>{if(!offered.current && feed.isSuccess && feed.isFetchedAfterMount && !feed.isFetching){offered.current=true;if(items.length)setOpen(true);}},[feed.isSuccess,feed.isFetchedAfterMount,feed.isFetching,items.length]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open)dialog.current?.close();},[open]);
 useEffect(()=>{if(!open||!sentinel.current||!feed.hasNextPage)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting&&!feed.isFetching&&!feed.isError)void feed.fetchNextPage();},{root:dialog.current});observer.observe(sentinel.current);return()=>observer.disconnect();},[open,feed.hasNextPage,feed.isFetching,feed.isError,feed.fetchNextPage]);
 const close=useMutation({mutationFn:async()=>{if(userId){const ids=items.filter(x=>!x.dismissed).map(x=>x.id);for(let start=0;start<ids.length;start+=500)await announcementService.dismissMany(ids.slice(start,start+500));}},onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:["announcements",userId??"public"]});}});
 return <>{userId&&<button className="announcement-entry" data-icon-motion="pop" type="button" onClick={()=>{offered.current=true;close.reset();setMode("history");setOpen(true);}} aria-label={t("announcements.readHistory")} title={t("announcements.readHistory")}><svg className="announcement-entry-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h8"/></svg></button>}
 <dialog ref={dialog} className="customer-announcements" aria-labelledby="announcement-heading" onCancel={e=>{e.preventDefault();if(!close.isPending)close.mutate();}}>
 <header><h2 id="announcement-heading">{t(mode==="history"?"announcements.history":"announcements.newNotices")}</h2><button className="announcement-close" type="button" disabled={close.isPending} aria-label={t(userId?"announcements.dismiss":"announcements.close")} title={t(userId?"announcements.dismiss":"announcements.close")} onClick={()=>close.mutate()} data-icon-motion="press"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
 {items.map(item=><article key={item.id}><h3>{item.title}</h3><time dateTime={item.publishedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(item.publishedAt))}</time><p>{item.body}</p></article>)}
 {feed.isPending&&<p role="status">{t("announcements.loading")}</p>}{feed.isSuccess&&!items.length&&<p>{t("announcements.empty")}</p>}
 {(feed.error||close.error)&&<div role="alert"><p>{localizedApiError(feed.error??close.error,t)}</p><button type="button" disabled={close.isPending} onClick={()=>close.error?close.mutate():void feed.refetch()}>{t("announcements.retry")}</button>{close.error&&<button type="button" onClick={()=>setOpen(false)}>{t("announcements.close")}</button>}</div>}
 <div ref={sentinel}/>{feed.hasNextPage?<button type="button" disabled={feed.isFetching} onClick={()=>void feed.fetchNextPage()}>{t(feed.isFetching?"announcements.loading":"announcements.more")}</button>:items.length>0&&<p className="announcement-end">{t("announcements.end")}</p>}
 </dialog></>;
}
