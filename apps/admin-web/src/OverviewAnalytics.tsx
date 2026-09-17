import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { HelpPopover } from "@lifewood/ui/help-popover";
import "./overview-analytics.css";

export function OverviewAnalytics({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = useQuery({ queryKey: ["admin-analytics", days, timeZone], queryFn: ({ signal }) => adminService.getOverviewAnalytics(days, timeZone, signal) });
  const data = query.data;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = (value: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value + "T12:00:00"));
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([query.refetch(), new Promise(resolve => setTimeout(resolve, 650))]); }
    finally { setRefreshing(false); }
  };
  const maximum = Math.ceil(Math.max(2, ...data?.trend.flatMap(day => [day.submitted, day.completed]) ?? []) / 2) * 2;
  const x = (index: number) => 36 + index * 688 / Math.max(1, (data?.trend.length ?? 1) - 1);
  const y = (count: number) => 164 - count / maximum * 130;
  const current = data?.trend.find(day => day.date === selected) ?? data?.trend.at(-1);
  return <section className="admin-analytics" aria-label={t("adminAnalytics.title")}>
    <div className="analytics-toolbar">
      <h2>{t("adminAnalytics.title")}</h2>
      <HelpPopover label={t("adminAnalytics.method")}>
        <p>{t("adminAnalytics.definition")}</p>
        <p>{t("adminAnalytics.scope", { timeZone })}</p>
        {data && <p>{t("adminAnalytics.coverage", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.trackingStartedAt)), count: data.untrackedCompleted })}</p>}
      </HelpPopover>
      <div className="analytics-toolbar-actions">
        <select aria-label={t("adminAnalytics.period")} value={days} onChange={e => { setDays(Number(e.target.value)); setSelected(undefined); }}>
          {[7, 30, 90].map(value => <option key={value} value={value}>{t("adminAnalytics.days", { count: value })}</option>)}
        </select>
        <button type="button" className="analytics-refresh" aria-label={t("adminAnalytics.refresh")} title={t("adminAnalytics.refresh")} disabled={query.isFetching || refreshing} onClick={() => void refresh()}>
          <svg className={query.isFetching || refreshing ? "is-spinning" : ""} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg>
        </button>
      </div>
    </div>
    {query.isPending && <p role="status">{t("common.loading")}</p>}
    {query.isError && <div role="alert" className="message error">{localizedApiError(query.error, t)} <button type="button" onClick={() => void refresh()} disabled={refreshing}>{t("common.retry")}</button></div>}
    {data && <>
      <div className="analytics-metrics">
        {(["averageDays", "medianDays"] as const).map(key => <div key={key}><span>{t(`adminAnalytics.${key}`)}</span><strong>{data[key] == null ? "—" : t("adminAnalytics.duration", { value: n.format(data[key]) })}</strong><small>{t("adminAnalytics.samples", { count: data.durationSamples })}</small></div>)}
        {(["completed", "submitted"] as const).map(key => <div key={key}><span>{t(`adminAnalytics.${key}`)}</span><strong>{n.format(data[key])}</strong><small>{t("adminAnalytics.days", { count: days })}</small></div>)}
      </div>
      <div className="analytics-charts">
        <section className="overview-panel analytics-trend">
          <h3>{t("adminAnalytics.trend")}</h3>
          <div className="analytics-legend"><span><i />{t("adminAnalytics.submitted")}</span><span><i />{t("adminAnalytics.completed")}</span></div>
          <div className="analytics-chart-scroll">
            <svg viewBox="0 0 760 204" role="group" aria-label={t("adminAnalytics.trend")}>
              {[0, 0.5, 1].map(fraction => <g key={fraction} aria-hidden="true"><line x1="36" x2="724" y1={y(maximum * fraction)} y2={y(maximum * fraction)} stroke="currentColor" opacity=".1" /><text x="26" y={y(maximum * fraction) + 4} textAnchor="end">{n.format(maximum * fraction)}</text></g>)}
              {(["submitted", "completed"] as const).map(key => <polyline key={key} className={`trend-${key}`} points={data.trend.map((day, i) => `${x(i)},${y(day[key])}`).join(" ")} fill="none" strokeWidth="2.5" aria-hidden="true" />)}
              {data.trend.map((day, index) => <g key={day.date} role="button" tabIndex={0} aria-pressed={current?.date === day.date} aria-label={t("adminAnalytics.daySummary", { date: date(day.date), submitted: day.submitted, completed: day.completed })} onClick={() => setSelected(day.date)} onFocus={() => setSelected(day.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(day.date); } }}>
                <rect className="trend-hit" x={x(index) - 344 / data.trend.length} y="24" width={688 / data.trend.length} height="150" rx="3" fill="transparent" />
                {current?.date === day.date && <line x1={x(index)} x2={x(index)} y1="24" y2="174" stroke="currentColor" opacity=".3" strokeDasharray="3 4" pointerEvents="none" />}
                {(["submitted", "completed"] as const).map(key => <circle key={key} className={`trend-${key}`} cx={x(index)} cy={y(day[key])} r={current?.date === day.date ? 4 : 2.5} strokeWidth="2" fill="white" pointerEvents="none" />)}
                <title>{t("adminAnalytics.daySummary", { date: date(day.date), submitted: day.submitted, completed: day.completed })}</title>
              </g>)}
              {[...new Set([0, Math.floor((data.trend.length - 1) / 2), data.trend.length - 1])].map(index => <text key={index} x={x(index)} y="198" textAnchor={index === 0 ? "start" : index === data.trend.length - 1 ? "end" : "middle"}>{date(data.trend[index].date)}</text>)}
            </svg>
          </div>
          <p className="analytics-day" aria-live="polite">{current && t("adminAnalytics.daySummary", { date: date(current.date), submitted: current.submitted, completed: current.completed })}</p>
        </section>
        <section className="overview-panel analytics-aging">
          <h3>{t("adminAnalytics.aging")} <HelpPopover label={t("adminAnalytics.aging")}><p>{t("adminAnalytics.agingHelp")}</p></HelpPopover></h3>
          <ul>{data.aging.map(item => <li key={item.id}><div><span>{t(`adminAnalytics.ages.${item.id}`)}</span><strong>{item.count}</strong></div><span className="metric-track" aria-hidden="true"><i style={{ width: `${item.count / Math.max(1, ...data.aging.map(age => age.count)) * 100}%` }} /></span></li>)}</ul>
        </section>
      </div>
      <div className="analytics-queues" aria-label={t("adminAnalytics.currentQueues")}>{data.queues.map(item => <Link key={item.id} to={`/${locale}/workbench?queue=${item.id}`}><span>{t(`adminAnalytics.queues.${item.id}`)}</span><strong>{item.count}<span aria-hidden="true"> →</span></strong></Link>)}</div>
    </>}
  </section>;
}
