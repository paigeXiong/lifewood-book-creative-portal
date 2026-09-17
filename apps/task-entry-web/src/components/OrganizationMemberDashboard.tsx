import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HelpPopover } from "@lifewood/ui/help-popover";
import type { OrganizationMemberActivity, SupportedLocale } from "@lifewood/domain";
import { MemberActivityCalendar } from "./MemberActivityCalendar";

export function OrganizationMemberDashboard({ data, locale, selection, onSelect, busy, onRefresh }: {
  data?: OrganizationMemberActivity; locale: SupportedLocale; selection: { search: string; page: number };
  onSelect: (value: { search: string; page: number }) => void; busy: boolean; onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(selection.search);
  if (!data) return <div className="organization-member-profile" role="status" aria-busy="true">{t("common.loading")}</div>;
  const labels = data.labels;
  const date = (value?: string) => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : labels.noRecord;
  const search = (event: FormEvent) => { event.preventDefault(); onSelect({ search: input.trim(), page: 1 }); };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="member-dashboard" aria-busy={busy}>
    <section className="member-presence organization-member-profile" aria-label={labels.activity}>
      <header><h2>{labels.activity}</h2><HelpPopover label={labels.activity}>{labels.presenceHelp} {labels.calendarHelp}</HelpPopover><span className={`member-presence-badge is-${data.presence.status}`}>{data.presenceLabel}</span><button className="my-org-icon" type="button" title={t("common.refresh")} aria-label={t("common.refresh")} data-icon-motion="refresh" disabled={busy} onClick={onRefresh}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg></button></header>
      {data.calendar && <MemberActivityCalendar calendar={data.calendar} labels={labels} locale={locale} />}
      <dl className="member-presence-recent"><div><dt>{labels.lastLogin}</dt><dd>{date(data.presence.lastLoginAt)}</dd></div><div><dt>{labels.lastActive}</dt><dd>{date(data.presence.lastActiveAt)}</dd></div></dl>
    </section>
    <section className="member-metrics" aria-label={labels.submitted}>{(["submitted", "inProgress", "actionRequired", "completed"] as const).map(key => <div key={key}><span>{labels[key]}</span><strong>{data.counts[key].toLocaleString(locale)}</strong></div>)}</section>
    <section className="member-requests organization-member-profile" aria-label={labels.requests}>
      <header><h2>{labels.requests}</h2><HelpPopover label={labels.requests}>{labels.scope}</HelpPopover><form role="search" aria-label={labels.search} className="my-org-search" onSubmit={search}><input type="search" maxLength={100} aria-label={labels.search} placeholder={labels.search} value={input} onChange={event => { setInput(event.target.value); if (!event.target.value) onSelect({ search: "", page: 1 }); }} /><button type="submit" className="my-org-icon" title={t("common.search")} aria-label={t("common.search")} data-icon-motion="press"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></button></form></header>
      <div className="member-requests-content">{data.projects.length ? <table><thead><tr><th>{labels.name}</th><th>{labels.status}</th><th>{labels.submittedAt}</th></tr></thead><tbody>{data.projects.map(project => <tr key={project.id}><td>{project.canOpen ? <Link to={`/${locale}/tasks/${encodeURIComponent(project.id)}`}>{project.name}</Link> : <strong>{project.name}</strong>}</td><td>{project.statusLabel}</td><td>{date(project.submittedAt)}</td></tr>)}</tbody></table> : <p className="my-org-empty" role="status">{labels.empty}</p>}</div>
      <nav className="my-org-pager" aria-label={labels.requests}><span>{t("common.pageOf", { page: data.page, pages })} · {data.total.toLocaleString(locale)}</span><div><button className="button button-secondary" disabled={busy || data.page <= 1} onClick={() => onSelect({ ...selection, page: data.page - 1 })}>{t("common.previous")}</button><button className="button button-secondary" disabled={busy || data.page >= pages} onClick={() => onSelect({ ...selection, page: data.page + 1 })}>{t("common.next")}</button></div></nav>
    </section>
  </div>;
}
