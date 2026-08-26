import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";

const PageSize = 30;

export function auditDayBoundary(
  value: string,
  endExclusive: boolean,
): string | undefined {
  if (!value) return undefined;
  const instant = new Date(`${value}T00:00:00.000`);
  if (endExclusive) instant.setDate(instant.getDate() + 1);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

export function AuditPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [actionId, setActionId] = useState(searchParams.get("action") ?? "");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [page, setPage] = useState(() =>
    Math.max(1, Number(searchParams.get("page")) || 1),
  );
  const updateUrl = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setSearchParams(next, { replace: true });
  };
  const fromInstant = auditDayBoundary(from, false);
  const toInstant = auditDayBoundary(to, true);
  const actions = useQuery({
    queryKey: ["admin-audit-actions", locale],
    queryFn: () => adminService.listAuditActions(locale),
  });
  const events = useQuery({
    queryKey: ["admin-audit-events", search, actionId, from, to, page],
    queryFn: () =>
      adminService.listAuditEvents({
        search: search || undefined,
        actionId: actionId || undefined,
        from: fromInstant,
        to: toInstant,
        page,
        pageSize: PageSize,
      }),
  });
  const actionLabels = useMemo(
    () => new Map(actions.data?.map((item) => [item.id, item.label]) ?? []),
    [actions.data],
  );
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const pages = Math.max(1, Math.ceil((events.data?.total ?? 0) / PageSize));
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setPage(1);
    setSearch(value);
    updateUrl({ q: value, page: undefined });
  };

  return (
    <main className="content audit-content">
      <section className="page-toolbar">
        <form onSubmit={submitSearch} role="search">
          <input
            name="q"
            autoComplete="off"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label={t("admin.audit.search")}
            placeholder={t("admin.audit.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <label className="compact-filter">
          <span className="sr-only">{t("admin.audit.actionFilter")}</span>
          <select
            value={actionId}
            onChange={(event) => {
              setPage(1);
              setActionId(event.target.value);
              updateUrl({ action: event.target.value, page: undefined });
            }}
          >
            <option value="">{t("admin.audit.allActions")}</option>
            {actions.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="compact-filter date-filter">
          <span>{t("admin.audit.from")}</span>
          <input
            name="from"
            autoComplete="off"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              setPage(1);
              setFrom(event.target.value);
              updateUrl({ from: event.target.value, page: undefined });
            }}
          />
        </label>
        <label className="compact-filter date-filter">
          <span>{t("admin.audit.to")}</span>
          <input
            name="to"
            autoComplete="off"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              setPage(1);
              setTo(event.target.value);
              updateUrl({ to: event.target.value, page: undefined });
            }}
          />
        </label>
        <span className="result-count push-right">
          {t("admin.audit.count", { count: events.data?.total ?? 0 })}
        </span>
      </section>
      <section
        className="table-card audit-table-card"
        aria-label={t("admin.audit.list")}
        aria-busy={events.isPending}
      >
        {events.isError && (
          <div className="message error" role="alert">
            {localizedApiError(events.error, t)}
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>{t("admin.audit.actor")}</th>
              <th>{t("admin.audit.action")}</th>
              <th>{t("admin.audit.target")}</th>
              <th>{t("admin.audit.time")}</th>
              <th>{t("admin.audit.request")}</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.items.map((event) => (
              <tr key={event.id}>
                <td>
                  <div className="user-cell">
                    <img
                      src={`/api/admin/audit-avatar/${encodeURIComponent(event.actorUserId)}?name=${encodeURIComponent(event.actorName)}`}
                      alt=""
                      width="32"
                      height="32"
                    />
                    <div>
                      <strong>{event.actorName}</strong>
                      <small>{event.actorEmail}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="audit-action">
                    {actionLabels.get(event.actionId) ?? event.actionId}
                  </span>
                </td>
                <td>
                  <code>{event.targetId ?? "—"}</code>
                </td>
                <td>
                  <time dateTime={event.occurredAt}>
                    {formatter.format(new Date(event.occurredAt))}
                  </time>
                </td>
                <td>
                  <code title={event.traceId}>
                    {event.traceId.slice(0, 12)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.isPending && !events.data?.items.length && (
          <div className="empty">{t("admin.audit.empty")}</div>
        )}
        <nav className="pager">
          <button
            disabled={page <= 1}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              updateUrl({ page: next > 1 ? String(next) : undefined });
            }}
          >
            {t("common.previous")}
          </button>
          <span>{t("common.pageOf", { page, pages })}</span>
          <button
            disabled={page >= pages}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              updateUrl({ page: String(next) });
            }}
          >
            {t("common.next")}
          </button>
        </nav>
      </section>
    </main>
  );
}
