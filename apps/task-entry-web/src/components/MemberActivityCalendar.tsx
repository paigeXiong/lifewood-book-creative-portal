import { useState } from "react";
import type { OrganizationMemberActivity, SupportedLocale } from "@lifewood/domain";

type Props = { calendar: OrganizationMemberActivity["calendar"]; labels: Record<string, string>; locale: SupportedLocale };
const isoDate = (date: string) => new Date(`${date}T12:00:00Z`);
export function MemberActivityCalendar({ calendar, labels, locale }: Props) {
  const months = [...new Set(calendar.days.map(day => day.date.slice(0, 7)))];
  const today = calendar.days.at(-1)?.date ?? "";
  const [chosenMonth, setMonth] = useState("");
  const [selected, select] = useState("");
  const month = months.includes(chosenMonth) ? chosenMonth : months.at(-1)!;
  const days = calendar.days.filter(day => day.date.startsWith(month));
  const detail = days.find(day => day.date === selected) ?? days.at(-1);
  if (!month || !detail) return null;
  const first = isoDate(`${month}-01`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const position = months.indexOf(month);
  const level = (value: number) => value === 0 ? 0 : value < 3 ? 1 : value < 7 ? 2 : value < 13 ? 3 : 4;
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(isoDate(date));
  const summary = (day: typeof detail) => day.collected ? `${labels.logins}: ${day.logins} · ${labels.periods}: ${day.activePeriods}` : labels.uncollected;
  return <div className="member-calendar-layout">
    <div className="member-calendar">
      <div className="member-calendar-toolbar"><strong>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(first)}</strong><div>
        <button className="my-org-icon" type="button" disabled={position === 0} aria-label={labels.previousMonth} title={labels.previousMonth} onClick={() => { setMonth(months[position - 1]); select(""); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m14 6-6 6 6 6" /></svg></button>
        <button className="my-org-icon" type="button" disabled={position === months.length - 1} aria-label={labels.nextMonth} title={labels.nextMonth} onClick={() => { setMonth(months[position + 1]); select(""); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m10 6 6 6-6 6" /></svg></button>
      </div></div>
      <div className="member-calendar-grid" role="group" aria-label={labels.calendar}>
        {Array.from({ length: 7 }, (_, index) => <span className="member-calendar-weekday" key={`weekday-${index}`}>{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5 + index)))}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`pad-${index}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, "0")}`;
          const day = days.find(item => item.date === date);
          const text = `${dateLabel(date)} · ${day ? summary(day) : labels.future}`;
          return <button type="button" key={date} className={`member-calendar-day ${day ? day.collected ? `level-${level(day.logins + day.activePeriods)}` : "is-unknown" : "is-future"}`} disabled={!day} aria-label={text} title={text} aria-pressed={detail.date === date} aria-current={date === today ? "date" : undefined} onMouseEnter={() => select(date)} onFocus={() => select(date)} onClick={() => select(date)}><span>{(index + 1).toLocaleString(locale)}</span></button>;
        })}
      </div>
      <div className="member-calendar-legend"><span className="unknown-key" />{labels.uncollected}<span className="member-calendar-scale">{labels.less}{[0, 1, 2, 3, 4].map(value => <i key={value} className={`level-${value}`} />)}{labels.more}</span></div>
    </div>
    <div className="member-calendar-detail" aria-live="polite" aria-atomic="true"><strong>{dateLabel(detail.date)}</strong>{detail.collected ? <dl><div><dt>{labels.logins}</dt><dd>{detail.logins.toLocaleString(locale)}</dd></div><div><dt>{labels.periods}</dt><dd>{detail.activePeriods.toLocaleString(locale)}</dd></div></dl> : <p>{labels.uncollected}</p>}</div>
  </div>;
}
