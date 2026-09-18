import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { helpService, localizedApiError } from "@lifewood/api-client";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";
import "./function-search.css";

export function FunctionSearch({ user, locale }: { user: CurrentUser; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  const [blocked, setBlocked] = useState(false);
  const close = () => { dialog.current?.close(); setOpen(false); };
  useEffect(() => { close(); }, [location.pathname, location.search]);
  useEffect(() => {
    const changed = () => { setBlocked(true); close(); setValue(""); setSearch(""); };
    window.addEventListener("lw-account-changed", changed);
    return () => window.removeEventListener("lw-account-changed", changed);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(value.trim()), 200); return () => window.clearTimeout(timer); }, [value]);
  const query = useQuery({ queryKey: ["admin-function-search", user.id, locale, search],
    queryFn: ({ signal }) => helpService.searchFunctions(locale, search, signal),
    enabled: open && !blocked && !!search, retry: false, gcTime: 0, staleTime: 0 });
  const pending = value.trim() !== search || query.isFetching;
  return <>
    <button ref={trigger} className="function-search-trigger" type="button" disabled={blocked} aria-haspopup="dialog" onClick={() => {
      setValue(""); setSearch(""); setOpen(true); dialog.current?.showModal(); input.current?.focus();
    }}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span>{t("functionSearch.placeholder")}</span></button>
    <dialog ref={dialog} className="function-search-dialog" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }} aria-label={t("functionSearch.title")} onClose={() => { setOpen(false); trigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) { const r=event.currentTarget.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) close(); } }}>
      <div className="function-search-heading"><strong>{t("functionSearch.title")}</strong><button type="button" onClick={close} aria-label={t("functionSearch.close")}>×</button></div>
      <input ref={input} autoFocus type="search" maxLength={100} value={value} onChange={event => setValue(event.target.value)} placeholder={t("functionSearch.example")} aria-label={t("functionSearch.placeholder")} />
      <div className="function-search-results" aria-busy={pending}>
        {!value.trim() ? <p>{t("functionSearch.hint")}</p> : pending ? <p role="status">{t("common.loading")}</p> : query.isError ? <div role="alert">{localizedApiError(query.error, t)} <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button></div> : !blocked && query.data?.length ? (["function", "admin", "customer"] as const).map(kind => {
          const items = query.data.filter(item => item.kind === kind);
          return items.length ? <section key={kind}><h2>{t(`functionSearch.${kind}`)}</h2>{items.map(item => <Link key={item.path} to={`/${locale}${item.path}`} onClick={close}><strong>{item.title}</strong><small>{item.category}</small></Link>)}</section> : null;
        }) : <p role="status">{t("functionSearch.empty")}</p>}
      </div>
    </dialog>
  </>;
}
