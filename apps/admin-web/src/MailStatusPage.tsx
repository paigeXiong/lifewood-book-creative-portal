import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localizedApiError, mailQueueService } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { SettingsTabs } from "./SettingsTabs";
import { HelpPopover } from "./HelpPopover";
import { MailServiceControls } from "./MailServiceControls";
import "./mail-status.css";

export function MailStatusPage({ locale, allowed }: { locale: SupportedLocale; allowed: boolean }) {
  const { t } = useTranslation(), [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "", kind = params.get("kind") ?? "";
  const rawPage = Number(params.get("page") ?? 1), page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1;
  const query = useQuery({ queryKey: ["admin-mail-queue", status, kind, page], queryFn: ({ signal }) => mailQueueService.list(status, kind, page, signal), enabled: allowed, retry: false });
  const data = query.data;
  function filter(key: string, value: string) {
    setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); return next; });
  }
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale);
  return <main className="content config-content mail-status-content pagination-layout"><SettingsTabs locale={locale} />
    {!allowed ? <p role="alert">{t("mailQueue.ownerOnly")}</p> : <section className="panel mail-status pagination-layout pagination-surface">
      <div className="mail-status-header">
        {data && <div className="mail-config-state" data-ready={data.available}><span className="mail-config-dot" aria-hidden="true" /><span role="status">{t(data.available ? "mailQueue.available" : "mailQueue.unavailable")}</span>{!!data.configurationChecks?.length && <HelpPopover label={t("mailQueue.configuration.title")}>
          <p>{t("mailQueue.configuration.scope")}</p>
          <ul className="mail-config-checks">{data.configurationChecks.map(check => <li key={check.code}><div><strong>{t(`mailQueue.configuration.labels.${check.code}`)}</strong><span>{t(check.passed ? "mailQueue.configuration.passed" : "mailQueue.configuration.failed")}</span></div>{!check.passed && <p>{t(`mailQueue.configuration.hints.${check.code}`)}</p>}</li>)}</ul>
        </HelpPopover>}</div>}
        <div className="mail-status-actions">
        <MailServiceControls locale={locale} />
        <Link className="mail-template-link" to={`/${locale}/settings/mail/templates`}>{t("mailEditor.title")}</Link>
        {data && <time dateTime={new Date(data.checkedAt * 1000).toISOString()}>{t("mailQueue.checked", { time: date(data.checkedAt) })}</time>}
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("mailQueue.refresh")}</button>
        <HelpPopover label={t("mailQueue.title")}>{t("mailQueue.help")}</HelpPopover>
        </div>
      </div>
      {query.error && <p role="alert">{data ? t("recovery.refreshFailed") : localizedApiError(query.error, t)}</p>}
      {query.isPending ? <p role="status">{t("common.loading")}</p> : data && <>
        <div className="mail-status-counts">{data.counts.map(item => <button key={item.status} type="button" aria-pressed={status === item.status} onClick={() => filter("status", status === item.status ? "" : item.status)}><span>{t(`mailQueue.states.${item.status}`)}</span> <strong>{item.count.toLocaleString(locale)}</strong></button>)}</div>
        <div className="mail-status-toolbar mail-status-filters">
          <label>{t("mailQueue.status")}<select value={status} onChange={e => filter("status", e.target.value)}><option value="">{t("mailQueue.all")}</option>{data.counts.map(item => <option key={item.status} value={item.status}>{t(`mailQueue.states.${item.status}`)}</option>)}</select></label>
          <label>{t("mailQueue.kind")}<select value={kind} onChange={e => filter("kind", e.target.value)}><option value="">{t("mailQueue.all")}</option>{data.kinds.map(item => <option key={item} value={item}>{t(`mailQueue.kinds.${item}`)}</option>)}</select></label>
          {(status || kind) && <button type="button" onClick={() => setParams({})}>{t("mailQueue.clear")}</button>}
        </div>
        {!data.items.length ? <p className="mail-status-empty pagination-scroll" role="status">{t("mailQueue.empty")}</p> : <div className="mail-status-table pagination-scroll"><table><thead><tr><th>{t("mailQueue.recipient")}</th><th>{t("mailQueue.kind")}</th><th>{t("mailQueue.status")}</th><th>{t("mailQueue.failures")}</th><th>{t("mailQueue.next")}</th><th>{t("mailQueue.expires")}</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.recipient}</td><td>{t(`mailQueue.kinds.${item.kind}`)}</td><td>{t(`mailQueue.states.${item.status}`)}</td><td>{item.failures}</td><td>{item.nextAttempt == null ? "—" : date(item.nextAttempt)}</td><td>{date(item.expires)}</td></tr>)}</tbody></table></div>}
        <div className="mail-status-toolbar mail-status-pagination pagination-footer"><span>{t("mailQueue.page", { page: data.page, pages: Math.max(1, Math.ceil(data.total / data.pageSize)), count: data.total })}</span><div className="mail-status-page-actions"><button type="button" disabled={query.isFetching || data.page <= 1} onClick={() => filter("page", String(data.page - 1))}>{t("mailQueue.previous")}</button><button type="button" disabled={query.isFetching || data.page * data.pageSize >= data.total} onClick={() => filter("page", String(data.page + 1))}>{t("mailQueue.nextPage")}</button></div></div>
      </>}
      {!data && query.error && (status || kind) && <button type="button" onClick={() => setParams({})}>{t("mailQueue.clear")}</button>}
    </section>}
  </main>;
}
