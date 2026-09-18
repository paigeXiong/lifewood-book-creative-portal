import "./segmented-control.css";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { helpService, localizedApiError } from "@lifewood/api-client";
import "./help-center.css";

export function HelpCenter({ userId, locale, canReadAdmin }: { userId: string; locale: string; canReadAdmin: boolean }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const audience = params.get("audience") === "admin" ? "admin" : "customer";
  const search = (params.get("q") ?? "").slice(0, 200);
  const [input, setInput] = useState(search);
  const [invalidated, setInvalidated] = useState(false);
  const imageDialog = useRef<HTMLDialogElement>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const previousArticle = useRef(params.get("article"));
  useEffect(() => setInput(search), [search]);
  useEffect(() => {
    const changed = () => { setInvalidated(true); imageDialog.current?.close(); };
    window.addEventListener("lw-account-changed", changed);
    return () => window.removeEventListener("lw-account-changed", changed);
  }, []);
  const query = useQuery({
    queryKey: ["help-center", userId, locale, audience, search],
    queryFn: ({ signal }) => helpService.list(locale, audience, search, signal),
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      // Preserve layout only within the same identity, language and allowed audience.
      return !invalidated && key?.[1] === userId && key?.[2] === locale
        && (key?.[3] !== "admin" || canReadAdmin) ? previous : undefined;
    },
    enabled: !invalidated && (audience !== "admin" || canReadAdmin), retry: false, staleTime: 0, gcTime: 0,
  });
  const selectedId = params.get("article");
  const articles = query.data ?? [];
  const selected = articles.find(item => item.id === selectedId);
  useEffect(() => {
    if (previousArticle.current !== selectedId && selected) articleHeading.current?.focus();
    previousArticle.current = selectedId;
    imageDialog.current?.close();
  }, [selectedId, selected]);
  const target = (article?: string) => {
    const next = new URLSearchParams(params);
    if (article) next.set("article", article); else next.delete("article");
    return `?${next}`;
  };
  return <section className="help-center" aria-label={t("help.title")}>
    <div className="help-toolbar">
      {canReadAdmin && <div className="help-audiences lw-segmented" role="group" aria-label={t("help.audience")}>
        {(["customer", "admin"] as const).map(value => <button type="button" key={value} aria-pressed={audience === value} onClick={() => {
          const next = new URLSearchParams(); next.set("audience", value); if (search) next.set("q", search); setParams(next);
        }}>{t(`help.${value}`)}</button>)}
      </div>}
      <form className="help-search" role="search" onSubmit={event => {
        event.preventDefault(); const next = new URLSearchParams(params); next.delete("article");
        if (input.trim()) next.set("q", input.trim()); else next.delete("q"); setParams(next);
      }}>
        <input type="search" maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder={t("help.search")} aria-label={t("help.search")} />
        <button type="submit">{t("help.find")}</button>
        {search && <button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete("q"); next.delete("article"); setParams(next); }}>{t("help.clear")}</button>}
      </form>
    </div>
    {invalidated ? <p role="alert">{t("accountSwitch.changed")}</p> : audience === "admin" && !canReadAdmin ? <p role="alert">{t("help.forbidden")} <Link to="?audience=customer">{t("help.customer")}</Link></p> : query.isPending ? <p role="status">{t("help.loading")}</p> : query.error ? <div role="alert">{localizedApiError(query.error, t)} <button type="button" onClick={() => void query.refetch()}>{t("help.retry")}</button></div> : <div className="help-results" aria-busy={query.isFetching} inert={query.isPlaceholderData}>
      {search && <p className="help-result-count" role="status">{t("help.results", { count: articles.length })}</p>}
      {selected ? <div className="help-reading">
        <nav className="help-contents" aria-label={t("help.contents")}>
          <Link to={target()}>{t("help.back")}</Link>
          {articles.map(item => <Link key={item.id} to={target(item.id)} aria-current={item.id === selected.id ? "page" : undefined}>{item.title}</Link>)}
        </nav>
        <article className="help-article">
          <span className="help-category">{selected.category}</span>
          <h1 ref={articleHeading} tabIndex={-1}>{selected.title}</h1>
          <p>{selected.summary}</p>
          <small>{t("help.updated", { date: selected.updated })}</small>
          <h2>{t("help.steps")}</h2>
          <ol>{selected.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          {selected.image && <figure>
            <button type="button" className="help-screenshot" aria-label={t("help.enlarge")} onClick={() => imageDialog.current?.showModal()}>
              <img src={helpService.imageUrl(selected.image, locale)} alt={t("help.imageAlt", { title: selected.title })} loading="lazy" />
            </button>
            <figcaption>{t("help.screenshotNote")}</figcaption>
          </figure>}
          <h2>{t("help.faq")}</h2>
          {selected.faq.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
          <dialog ref={imageDialog} className="help-image-dialog" aria-label={t("help.enlarge")}>
            <form method="dialog"><button autoFocus>{t("help.close")}</button></form>
            {selected.image && <img src={helpService.imageUrl(selected.image, locale)} alt={t("help.imageAlt", { title: selected.title })} />}
          </dialog>
        </article>
      </div> : selectedId ? <p role="status">{t("help.notFound")} <Link to={target()}>{t("help.back")}</Link></p> : articles.length === 0 ? <div className="help-empty"><p>{t("help.empty")}</p><button type="button" onClick={() => setParams({ audience })}>{t("help.clear")}</button></div> :
        <div className="help-catalog">{[...new Set(articles.map(item => item.category))].map(category => <section key={category}>
          <h2>{category}</h2><div className="help-cards">{articles.filter(item => item.category === category).map(item => <Link key={item.id} to={target(item.id)} className="help-card"><strong>{item.title}</strong><span>{item.summary}</span></Link>)}</div>
        </section>)}</div>}
    </div>}
  </section>;
}
