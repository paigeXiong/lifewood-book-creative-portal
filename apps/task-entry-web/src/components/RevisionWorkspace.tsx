import { useConfirm, useConfirmLink } from "../useConfirm";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams, Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { revisionService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import type { SupportedLocale } from "@lifewood/domain";
import { RevisionNavigation } from "../revision-navigation";
import { createId } from "../create-id";

type ReplyAttempt = {
  taskId: string;
  roundId: string;
  locale: SupportedLocale;
  message: { id: string; unit: string; body: string };
};

export function RevisionWorkspace({children}: {children: ReactNode}) {
  const { locale } = useParams();
  const location=useLocation();
  const path=location.pathname;
  const notification=new URLSearchParams(location.search).get("notification");
  const taskId=path.match(/\/tasks\/([^/]+)/)?.[1];
  const {t}=useTranslation();
  const confirm = useConfirm();
  const guardLink = useConfirmLink();
  const lang=isSupportedLocale(locale)?locale:"zh-CN";
  const client=useQueryClient();
  const [open,setOpen]=useState(false);
  const [unit,setUnit]=useState("");
  const [body,setBody]=useState("");
  const key=["revision",taskId,lang];
  const query=useQuery({queryKey:key,queryFn:()=>revisionService.get(taskId!,lang),enabled:Boolean(taskId),refetchInterval:10000});
  const data=query.data, round=data?.rounds[0];
  const attemptRef = useRef<ReplyAttempt | null>(null);
  const inFlightRef = useRef<ReplyAttempt | null>(null);
  const conversation = JSON.stringify([taskId, round?.id, lang]);
  const send = useMutation({
    mutationFn: (attempt: ReplyAttempt) => revisionService.reply(attempt.taskId, attempt.roundId, attempt.message, attempt.locale),
    onSuccess: async (_value, attempt) => {
      if (attemptRef.current === attempt) {
        setBody("");
        attemptRef.current = null;
      }
      // Fetch current data instead of overwriting newer polling results with a late reply response.
      await client.invalidateQueries({ queryKey: ["revision", attempt.taskId, attempt.locale] });
    },
    onSettled: (_data, _error, attempt) => {
      if (inFlightRef.current === attempt) inFlightRef.current = null;
    },
  });
  const resetSend = send.reset;
  useEffect(() => {
    attemptRef.current = null;
    inFlightRef.current = null;
    resetSend();
    setOpen(Boolean(round && !round.submittedAt && round.messages.length && !window.matchMedia?.("(max-width: 900px)").matches));
    setUnit("");
    setBody("");
  }, [conversation, resetSend]);
  useEffect(()=>{if(!notification||!round)return;const message=round.messages.find(m=>m.id===notification);if(message){setUnit(message.unit);setOpen(true);}else if(round.id===notification)setOpen(true);},[notification,round?.id]);
  useEffect(()=>{if(open&&notification)document.getElementById(`notification-${notification}`)?.scrollIntoView({block:"center"});},[open,unit,notification,query.data]);
  const selected=round?.reasons.some(r=>r.unit===unit)?unit:round?.reasons[0]?.unit??"";
  const sendReply = () => {
    if (!taskId || !round || round.submittedAt || !body.trim() || send.isPending || inFlightRef.current) return;
    const previous = attemptRef.current;
    // Reuse the message ID after an uncertain network failure to avoid a duplicate reply.
    const attempt = previous && previous.taskId === taskId && previous.roundId === round.id
      && previous.locale === lang && previous.message.unit === selected && previous.message.body === body
      ? previous : { taskId, roundId: round.id, locale: lang, message: { id: createId(), unit: selected, body } };
    attemptRef.current = attempt;
    inFlightRef.current = attempt;
    send.mutate(attempt);
  };
  if(!taskId)return <>{children}</>;
  // Wait for permission information before mounting autosaving forms.
  if(query.isPending)return <div role="status">{t("common.loading")}</div>;
  if(query.isError&&!data)return <div role="alert">{localizedApiError(query.error,t)}<button onClick={()=>void query.refetch()}>{t("common.retry")}</button></div>;
  const editing=path.includes("/edit/");
  const step=path.split("/").at(-1)!;
  const locked=editing&&round&&!round.submittedAt&&step!=="review"&&!round.reasons.some(r=>r.unit===step);
  if(locked)return <Navigate replace to={`/${lang}/tasks/${taskId}/edit/${round.reasons[0].unit}`}/>;
  const showChat = Boolean(editing && round && round.messages.length > 0);
  const active = editing && round && !round.submittedAt;
  return <RevisionNavigation.Provider value={round&&!round.submittedAt?[...round.reasons.map(r=>r.unit),"review"]:null}>
    <div className={"revision-workspace"+(showChat&&open?" with-feedback":"")}>
    <div className="revision-content">
    {active && <div className="revision-banner" role="status"><div><strong>{t("clientUx.returnedStatus")}</strong><span>{t("clientUx.requestedUnits")}：{round.reasons.map(r=>data!.units.find(u=>u.id===r.unit)?.label).join(" · ")}</span></div>{showChat&&<button type="button" className="button button-secondary" onClick={()=>setOpen(!open)} aria-expanded={open}>{t("clientUx.openFeedback")}</button>}</div>}
    {children}
    </div>
    {query.isError&&<div className="revision-refresh-error" role="alert">{t("wizard.revisionRefreshFailed")} <button type="button" className="button button-secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t("common.retry")}</button></div>}
    {showChat&&round&&<aside className={`revision-float ${open?"is-open":""}`}>
      <button className="button revision-toggle" onClick={()=>setOpen(!open)} aria-expanded={open}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg><span>{data!.labels.title}</span><b>{round.messages.length}</b></button>
      {open&&<section className="revision-chat" aria-label={data!.labels.title}>
        <header><strong>{round.submittedAt?data!.labels.submitted:data!.labels.pending}</strong><button type="button" onClick={()=>setOpen(false)} aria-label={data!.labels.close} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></header>
        <div className="revision-unit-picker">
        {round.reasons.length>1 ? <select disabled={send.isPending} aria-label={t("clientUx.requestedUnits")} value={selected} onChange={async e=>{const nextUnit=e.target.value;if(body.trim()&&!await confirm(t("wizard.unsavedChanges"), false))return;setUnit(nextUnit);setBody("");send.reset();}}>{round.reasons.map(r=><option key={r.unit} value={r.unit}>{data!.units.find(u=>u.id===r.unit)?.label}</option>)}</select> : <strong>{data!.units.find(u=>u.id===selected)?.label}</strong>}
        <Link to={step==="review"?"/"+lang+"/tasks/"+taskId+"/edit/"+selected:"/"+lang+"/tasks/"+taskId+"/edit/review"} onClick={guardLink}>{step==="review"?t("review.edit"):data!.labels.review}</Link>
        </div>
        <div className="revision-pinned-reason"><strong>{t("clientUx.returnReason")}</strong><p>{round.reasons.find(r=>r.unit===selected)?.body}</p></div>
        <div className="revision-messages" aria-live="polite">{round.messages.filter(m=>m.unit===selected).map(m=><article id={`notification-${m.id}`} key={m.id} className={m.isAdmin?"revision-message from-admin":"revision-message"}>
          {m.avatarUrl?<img src={m.avatarUrl} alt=""/>:<span className="revision-avatar">{m.authorName.slice(0,2)}</span>}
          <div><strong>{m.authorName}</strong><time>{new Date(m.createdAt).toLocaleString(lang)}</time><p>{m.body}</p></div>
        </article>)}</div>
        {!round.submittedAt&&<form onSubmit={e=>{e.preventDefault();sendReply();}}><textarea disabled={send.isPending} aria-label={data!.labels.reply} placeholder={data!.labels.reply} maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/>{send.isError&&<p role="alert">{localizedApiError(send.error,t)}</p>}<button className="button" disabled={!body.trim()||send.isPending}>{send.isPending ? t("clientUx.sendingReply") : data!.labels.send}</button></form>}
      </section>}
    </aside>}
    </div>
  </RevisionNavigation.Provider>;
}
