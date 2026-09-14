import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { optionService, projectService } from "@lifewood/api-client";
import type { CurrentUser, DashboardDay, DashboardProject } from "@lifewood/domain";
import { isSupportedLocale } from "@lifewood/i18n";
import { ScreenError } from "../components/ScreenError";
import { canRetainQueryData, RefreshNotice } from "../components/RefreshNotice";
import "./dashboard.css";

export function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function activityLevel(count: number): number { return count === 0 ? 0 : count === 1 ? 1 : count < 4 ? 2 : count < 8 ? 3 : 4; }
const activityCount = (day: DashboardDay) => day.submissions + day.resubmissions + day.deliveries;
const statusColors = ["#225b49", "#648477", "#a6bdb0", "#b29860", "#737f88", "#b8babc"];
function Arrow({ next = false }: { next?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={next ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} /></svg>;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const language = isSupportedLocale(locale) ? locale : "zh-CN";
  const { user } = useOutletContext<{ user: CurrentUser }>();
  const today = calendarDate(new Date());
  const [selection, setSelection] = useState({ month: today.slice(0, 7), day: Number(today.slice(8)), page: 1 });
  const { month, day, page } = selection;
  const [hiddenTooltip, setHiddenTooltip] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const report = useQuery({
    queryKey: ["customer-dashboard", user.id, language, month, timeZone, day, page],
    queryFn: ({ signal }) => projectService.getDashboard({ month, timeZone, day, page }, signal),
    staleTime: 0, refetchInterval: 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === user.id && previous?.month === month ? previous : undefined,
  });
  const options = useQuery({ queryKey: ["form-options", language], queryFn: () => optionService.getFormOptions(language) });
  const data = report.data;
  const format = (value: string, detail: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
    new Intl.DateTimeFormat(language, { ...detail, timeZone }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
  const fullDate = (value: string) => format(value, { year: "numeric", month: "long", day: "numeric" });
  const title = (project: DashboardProject) => project.projectName || project.bookTitle || project.taskNumber || t("dashboard.untitled");
  const projectPath = (project: DashboardProject) => `/${language}/tasks/${project.id}${project.status === "draft" ? "/edit/project" : ""}`;
  const changeMonth = (delta: number) => {
    const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + delta);
    const next = calendarDate(date).slice(0, 7);
    setSelection({ month: next, day: next === today.slice(0, 7) ? Number(today.slice(8)) : 1, page: 1 });
  };
  const selectedDate = `${month}-${String(day).padStart(2, "0")}`;
  const coverageDate = data ? calendarDate(new Date(data.historyCompleteFrom)) : today;
  const incomplete = (date: string) => date <= coverageDate;
  const labels = new Map([...(options.data?.taskStatuses ?? []), ...(options.data?.workflowStatuses ?? [])].map(item => [item.id, item.label]));
  const dailySummary = (item: DashboardDay) => `${t("dashboard.daySummary", { date: fullDate(item.date), count: activityCount(item), projects: item.projects })}. ${t("dashboard.breakdown", { ...item })}${incomplete(item.date) ? `. ${t("dashboard.partial")}` : ""}`;
  const fatalError = report.error && (!data || !canRetainQueryData(report.error));
  const max = Math.max(1, ...((data?.days ?? []).flatMap(item => [item.submissions + item.resubmissions, item.deliveries])));
  const x = (index: number) => 32 + index * 556 / Math.max(1, (data?.days.length ?? 1) - 1);
  const y = (count: number) => 160 - count / max * 126;
  const points = (kind: "submissions" | "deliveries") => (data?.days ?? []).map((item, index) => ({ item, index })).filter(({ item }) => item.date <= today && !incomplete(item.date)).map(({ item, index }) => `${x(index)},${y(kind === "submissions" ? item.submissions + item.resubmissions : item.deliveries)}`).join(" ");
  let segmentOffset = 0;

  return <div className="customer-dashboard">
    <div className="dashboard-toolbar">
      <div className="dashboard-month-control">
        <button type="button" className="dashboard-icon" disabled={month <= "2000-01"} aria-label={t("dashboard.monthPrevious")} onClick={() => changeMonth(-1)}><Arrow /></button>
        <strong aria-live="polite">{format(`${month}-01`, { year: "numeric", month: "long" })}</strong>
        <button type="button" className="dashboard-icon" disabled={month >= today.slice(0, 7)} aria-label={t("dashboard.monthNext")} onClick={() => changeMonth(1)}><Arrow next /></button>
        <button type="button" className="dashboard-text-button" onClick={() => setSelection({ month: today.slice(0, 7), day: Number(today.slice(8)), page: 1 })}>{t("dashboard.thisMonth")}</button>
      </div>
      <button type="button" className="dashboard-icon" disabled={report.isFetching} aria-label={t("dashboard.refresh")} title={t("dashboard.refresh")} onClick={() => void report.refetch()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 9A8 8 0 0 0 6 6L3 9m0-5v5h5M4 15a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></svg></button>
    </div>
    {fatalError ? <ScreenError error={report.error} onRetry={() => report.refetch()} /> : !data ? <div className="dashboard-loading" role="status">{t("common.loading")}</div> : <>
      <RefreshNotice error={report.error} onRetry={() => report.refetch()} />
      <div className="dashboard-metrics">
        {(["total", "actionRequired", "active", "downloadable"] as const).map(key => <div className={`dashboard-metric metric-${key}`} key={key}>
          <span>{t(`dashboard.${key}`)}</span><strong>{data.counts[key].toLocaleString(language)}</strong>
          {(key === "total" || key === "actionRequired") && <Link to={`/${language}/tasks${key === "actionRequired" ? "?status=action_required" : ""}`} aria-label={t(`dashboard.${key}`)}><Arrow next /></Link>}
        </div>)}
      </div>
      {data.counts.total === 0 && <p className="dashboard-empty">{t("dashboard.noProjects")} <Link to={`/${language}/tasks`}>{t("dashboard.projectsLink")}</Link></p>}
      <div className="dashboard-activity-layout">
        <section className="dashboard-panel dashboard-calendar" aria-labelledby="dashboard-calendar-title">
          <h2 id="dashboard-calendar-title">{t("dashboard.calendar")}</h2>
          <div className="dashboard-weekdays" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}>{new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, index + 1)))}</span>)}</div>
          <div className="dashboard-days">
            {Array.from({ length: (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7 }, (_, index) => <span key={`blank-${index}`} />)}
            {data.days.map(item => {
              const future = item.date > today, count = activityCount(item), partial = incomplete(item.date);
              return <div className="dashboard-day-wrap" key={item.date}>
                <button type="button" className={`dashboard-day level-${activityLevel(count)}${item.date === today ? " is-today" : ""}${partial ? " is-partial" : ""}`} disabled={future}
                  aria-pressed={item.date === selectedDate} aria-label={future ? `${fullDate(item.date)} · ${t("dashboard.future")}` : dailySummary(item)}
                  onMouseEnter={() => setHiddenTooltip(null)} onFocus={() => setHiddenTooltip(null)} onKeyDown={event => { if (event.key === "Escape") setHiddenTooltip(item.date); }}
                  onClick={() => setSelection(current => ({ ...current, day: Number(item.date.slice(8)), page: 1 }))}>
                  <span>{Number(item.date.slice(8))}</span><strong aria-hidden="true">{future ? "" : partial && count === 0 ? "—" : count.toLocaleString(language)}</strong>
                </button>
                {!future && hiddenTooltip !== item.date && <span className="dashboard-day-tooltip" aria-hidden="true">{dailySummary(item)}</span>}
              </div>;
            })}
          </div>
          <div className="dashboard-legend" aria-label={t("dashboard.legend")}>{["0", "1", "2–3", "4–7", "8+"].map((label, index) => <span key={label}><i className={`level-${index}`} />{label}</span>)}</div>
        </section>
        <section className="dashboard-panel dashboard-day-details" aria-labelledby="dashboard-day-title" aria-busy={report.isPlaceholderData}>
          <h2 id="dashboard-day-title">{t("dashboard.dayDetails")}</h2><p className="dashboard-selected-date">{fullDate(selectedDate)}</p>
          {incomplete(selectedDate) && <p className="dashboard-partial-note">{t("dashboard.partial")}</p>}
          {report.isPlaceholderData ? <p role="status">{t("common.loading")}</p> : data.activities.items.length === 0 ? <p className="dashboard-empty">{t(incomplete(selectedDate) ? "dashboard.noKnownActivity" : "dashboard.noActivity")}</p> : <>
            <ul className="dashboard-event-list">{data.activities.items.map(item => <li key={item.id}>
              <span className={`dashboard-event-dot event-${item.kind}`} aria-hidden="true" /><div><div className="dashboard-event-meta"><span>{t(`dashboard.${item.kind}`)}</span><time dateTime={item.occurredAt}>{format(item.occurredAt, { hour: "2-digit", minute: "2-digit" })}</time></div>
                <Link to={projectPath(item.project)}>{title(item.project)}</Link><small>{item.project.taskNumber || item.project.bookTitle}</small></div>
            </li>)}</ul>
            {data.activities.total > data.activities.pageSize && <div className="dashboard-pagination"><button type="button" className="dashboard-icon" aria-label={t("dashboard.previous")} disabled={data.activities.page === 1} onClick={() => setSelection(current => ({ ...current, page: data.activities.page - 1 }))}><Arrow /></button><span>{t("dashboard.pagination", { page: data.activities.page, pages: Math.ceil(data.activities.total / data.activities.pageSize), count: data.activities.total })}</span><button type="button" className="dashboard-icon" aria-label={t("dashboard.next")} disabled={data.activities.page * data.activities.pageSize >= data.activities.total} onClick={() => setSelection(current => ({ ...current, page: data.activities.page + 1 }))}><Arrow next /></button></div>}
          </>}
        </section>
      </div>
      <div className="dashboard-chart-layout">
        <section className="dashboard-panel dashboard-trend" aria-labelledby="dashboard-trend-title">
          <div className="dashboard-panel-heading"><h2 id="dashboard-trend-title">{t("dashboard.trend")}</h2><div className="dashboard-series"><span><i />{t("dashboard.submissions")}</span><span><i />{t("dashboard.deliveries")}</span></div></div>
          {incomplete(`${month}-01`) && <p className="dashboard-partial-note">{t("dashboard.partial")}</p>}
          <svg className="dashboard-line-chart" viewBox="0 0 620 190" role="img" aria-label={t("dashboard.trend")}>
            <title>{t("dashboard.trend")}</title>
            {[0, Math.ceil(max / 2), max].filter((n, i, a) => a.indexOf(n) === i).map(n => <g key={n}><line x1="32" x2="588" y1={y(n)} y2={y(n)} stroke="#e6ede8" /><text x="22" y={y(n) + 4} textAnchor="end">{n.toLocaleString(language)}</text></g>)}
            <polyline points={points("submissions")} fill="none" stroke="#225b49" strokeWidth="2.5" strokeLinejoin="round" />
            <polyline points={points("deliveries")} fill="none" stroke="#aa8540" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" />
            {data.days.map((item, index) => ({ item, index })).filter(({ item }) => item.date <= today && (!incomplete(item.date) || activityCount(item) > 0)).map(({ item, index }) => <g key={item.date}><title>{dailySummary(item)}</title>{(!incomplete(item.date) || item.submissions + item.resubmissions > 0) && <circle cx={x(index)} cy={y(item.submissions + item.resubmissions)} r="2.5" fill="#225b49" />}{(!incomplete(item.date) || item.deliveries > 0) && <circle cx={x(index)} cy={y(item.deliveries)} r="2.5" fill="#aa8540" />}</g>)}
            {data.days.filter((_, index) => index % 7 === 0).map(item => <text key={item.date} x={x(Number(item.date.slice(8)) - 1)} y="183" textAnchor="middle">{Number(item.date.slice(8))}</text>)}
          </svg>
          {!data.days.some(item => activityCount(item) > 0) && <p className="dashboard-chart-empty">{t("dashboard.noTrend")}</p>}
          <details className="dashboard-data-table"><summary>{t("dashboard.chartData")}</summary><div><table><thead><tr><th>{t("dashboard.date")}</th><th>{t("dashboard.submissions")}</th><th>{t("dashboard.deliveries")}</th></tr></thead><tbody>{data.days.filter(item => item.date <= today).map(item => <tr key={item.date}><td>{format(item.date)}{incomplete(item.date) && <span title={t("dashboard.partial")} aria-label={t("dashboard.partial")}> *</span>}</td><td>{incomplete(item.date) && item.submissions + item.resubmissions === 0 ? "—" : item.submissions + item.resubmissions}</td><td>{incomplete(item.date) && item.deliveries === 0 ? "—" : item.deliveries}</td></tr>)}</tbody></table></div></details>
        </section>
        <section className="dashboard-panel" aria-labelledby="dashboard-distribution-title"><h2 id="dashboard-distribution-title">{t("dashboard.distribution")}</h2>
          <div className="dashboard-distribution"><svg viewBox="0 0 120 120" role="img" aria-label={t("dashboard.distribution")}><circle cx="60" cy="60" r="46" fill="none" stroke="#edf1ee" strokeWidth="12" />{data.statuses.map((item, index) => {const size = item.count / Math.max(1, data.counts.total) * 100, offset = segmentOffset; segmentOffset += size;return <circle key={item.id} cx="60" cy="60" r="46" fill="none" stroke={statusColors[index % statusColors.length]} strokeWidth="12" pathLength="100" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;})}<text x="60" y="64" textAnchor="middle">{data.counts.total.toLocaleString(language)}</text></svg>
            {options.isError ? <ScreenError error={options.error} onRetry={() => options.refetch()} /> : options.isPending ? <p role="status">{t("common.loading")}</p> : <ul>{data.statuses.map((item, index) => <li key={item.id}><i style={{ background: statusColors[index % statusColors.length] }} /><span>{labels.get(item.id) ?? item.id}</span><strong>{item.count.toLocaleString(language)}</strong><small>{Math.round(item.count / Math.max(1, data.counts.total) * 100)}%</small></li>)}</ul>}
          </div>
        </section>
      </div>
      <section className="dashboard-panel dashboard-recent" aria-labelledby="dashboard-recent-title"><div className="dashboard-panel-heading"><h2 id="dashboard-recent-title">{t("dashboard.recent")}</h2><Link to={`/${language}/tasks`}>{t("dashboard.allProjects")}</Link></div>
        <ul>{data.recentProjects.map(project => <li key={project.id}><div><Link to={projectPath(project)}>{title(project)}</Link><small>{project.taskNumber || project.bookTitle}</small></div><span>{labels.get(project.status === "draft" && project.workflowStatus !== "awaiting_customer" ? "draft" : project.workflowStatus)}</span><time dateTime={project.updatedAt}>{format(project.updatedAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
      </section>
      <details className="dashboard-method"><summary>{t("dashboard.rules")}</summary><p>{t("dashboard.rulesText")}</p><p>{t("dashboard.coverage", { date: format(data.historyCompleteFrom, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</p><p>{t("dashboard.timezone", { zone: timeZone })}</p></details>
    </>}
  </div>;
}
