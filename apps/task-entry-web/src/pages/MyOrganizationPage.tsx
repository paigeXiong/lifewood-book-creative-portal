import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";
import { ScreenError } from "../components/ScreenError";
import "./my-organization.css";

export function MemberAvatar({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="my-org-avatar" aria-hidden="true">{failed ? name.trim().slice(0, 2).toLocaleUpperCase() : <img src={url} alt="" width="44" height="44" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

export function MyOrganizationPage() {
  const { locale } = useParams();
  const { user } = useOutletContext<{ user: CurrentUser }>();
  if (!isSupportedLocale(locale)) return null;
  return <OrganizationContent key={`${user.id}:${user.organization?.id ?? ""}:${locale}`} user={user} locale={locale} />;
}

function OrganizationContent({ user, locale }: { user: CurrentUser; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? "1");
  const selection = { search: (params.get("search") ?? "").slice(0, 100).trim(), page: Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 2147483647 ? rawPage : 1 };
  const [input, setInput] = useState(selection.search);
  useEffect(() => setInput(selection.search), [selection.search]);
  const setSelection = (value: typeof selection) => {
    const next = new URLSearchParams();
    if (value.search) next.set("search", value.search);
    if (value.page > 1) next.set("page", String(value.page));
    setParams(next);
  };
  const query = useQuery({
    queryKey: ["my-organization", user.id, user.organization?.id, locale, selection],
    queryFn: ({ signal }) => authService.getMyOrganization({ locale, ...selection, signal }),
    staleTime: 0,
    retry: false,
  });
  const search = (event: FormEvent) => { event.preventDefault(); setSelection({ search: input.trim(), page: 1 }); };
  const data = query.data;
  // Never retain a member directory after a failed authorization/background read.
  if (query.isError) return <ScreenError error={query.error} onRetry={() => query.refetch()} />;
  if (!data) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  if (!data.organization) return <div className="page my-org-page"><section className="my-org-panel my-org-unassigned"><p role="status">{data.labels.unassigned}</p><button className="button button-secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>{t("common.refresh")}</button></section></div>;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="page my-org-page">
    <section className="my-org-panel" aria-label={t("nav.myOrganization")} aria-busy={query.isFetching}>
      <header className="my-org-summary">
        <span className="my-org-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1M2 21h20" /></svg></span>
        <div className="my-org-name"><h1>{data.organization.name}</h1><span>{data.labels.members} · {data.organization.memberCount.toLocaleString(locale)}</span></div>
      <form className="my-org-search" role="search" aria-label={data.labels.search} onSubmit={search}>
        <input type="search" maxLength={100} aria-label={data.labels.search} placeholder={data.labels.search} value={input} onChange={event => { setInput(event.target.value); if (!event.target.value) setSelection({ search: "", page: 1 }); }} />
        <button className="my-org-icon" type="submit" aria-label={t("common.search")} title={t("common.search")} data-icon-motion="press"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></button>
      </form>
        <button className="my-org-icon" type="button" aria-label={t("common.refresh")} title={t("common.refresh")} data-icon-motion="refresh" disabled={query.isFetching} onClick={() => void query.refetch()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg></button>
      </header>

      <div className="my-org-results">
        {data.items.length ? <ul className="my-org-members" aria-label={data.labels.members}>{data.items.map(member => <li key={member.id}>
          <Link className="my-org-member-link" to={member.isSelf ? `/${locale}/profile` : `/${locale}/organization/members/${encodeURIComponent(member.id)}${location.search}`} aria-label={t("organizationMember.view", { name: member.displayName })}>
          <MemberAvatar key={member.avatarUrl} name={member.displayName} url={member.avatarUrl} />
          <div className="my-org-member-copy"><strong>{member.displayName}{member.isSelf && <small>{data.labels.you}</small>}</strong></div>
          </Link>
        </li>)}</ul> : <p className="my-org-empty" role="status">{data.labels.empty}</p>}
      </div>
      <nav className="my-org-pager" aria-label={data.labels.members}>
        <span>{t("common.pageOf", { page: data.page, pages })} · {data.labels.members} {data.total.toLocaleString(locale)}</span>
        <div><button className="button button-secondary" type="button" disabled={query.isFetching || data.page <= 1} onClick={() => setSelection({ ...selection, page: data.page - 1 })}>{t("common.previous")}</button><button className="button button-secondary" type="button" disabled={query.isFetching || data.page >= pages} onClick={() => setSelection({ ...selection, page: data.page + 1 })}>{t("common.next")}</button></div>
      </nav>
    </section>
  </div>;
}
