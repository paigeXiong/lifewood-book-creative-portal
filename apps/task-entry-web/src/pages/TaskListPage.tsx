import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { ProjectCoverImage } from "../components/ProjectCoverImage";
import { buildPagination } from "../pagination";

function presentValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "—" ? normalized : undefined;
}

const taskSortFields = ["project", "author", "status", "updated"] as const;
type TaskSortField = typeof taskSortFields[number];
type SortDirection = "asc" | "desc";

export function ProjectCover({ coverUrl, pendingLabel }: { coverUrl?: string | null; pendingLabel: string }) {
  return (
    <span className="list-cover-slot">
      <ProjectCoverImage coverUrl={coverUrl} coverAlt="" placeholderAlt={pendingLabel} className="list-cover" width={40} height={52} loading="lazy" />
    </span>
  );
}

export function TaskListPage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const search = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status") ?? "";
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const requestedSort = searchParams.get("sort");
  const sort: TaskSortField = taskSortFields.includes(requestedSort as TaskSortField) ? requestedSort as TaskSortField : "updated";
  const direction: SortDirection = searchParams.get("direction") === "asc" ? "asc" : "desc";
  const [searchInput, setSearchInput] = useState(search);
  const [showMobileCreate, setShowMobileCreate] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";

  const options = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const tasks = useQuery({
    queryKey: ["projects", validLocale, status, search, sort, direction, page],
    queryFn: () => projectService.listProjects({ locale: validLocale, status: status || undefined, search: search || undefined, sort, direction, page, pageSize: 10 }),
  });
  const stats = useQuery({ queryKey: ["project-stats"], queryFn: projectService.getStats });
  const createDraft = useMutation({
    mutationFn: () => projectService.createDraft(validLocale),
    onSuccess: async (draft) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project-stats"] }),
      ]);
      navigate(localizedPath(validLocale, `/tasks/${draft.id}/edit/project`));
    },
  });
  const deleteDraft = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => projectService.deleteDraft(id, version, validLocale),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project-stats"] }),
      ]);
      if ((tasks.data?.items.length ?? 0) <= 1 && page > 1) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          page - 1 > 1 ? next.set("page", String(page - 1)) : next.delete("page");
          return next;
        });
      }
    },
  });
  const statusMap = useMemo(() => new Map([...(options.data?.taskStatuses ?? []), ...(options.data?.workflowStatuses ?? [])].map((item) => [item.id, item])), [options.data]);
  const totalPages = Math.max(1, Math.ceil((tasks.data?.total ?? 0) / (tasks.data?.pageSize ?? 10)));
  const formatter = useMemo(() => new Intl.DateTimeFormat(validLocale, { dateStyle: "medium", timeStyle: "short" }), [validLocale]);

  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (!tasks.isSuccess || page <= totalPages) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      totalPages > 1 ? next.set("page", String(totalPages)) : next.delete("page");
      return next;
    }, { replace: true });
  }, [page, setSearchParams, tasks.isSuccess, totalPages]);
  useEffect(() => {
    const button = createButtonRef.current;
    if (!button || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowMobileCreate(!entry.isIntersecting),
      { rootMargin: "-72px 0px 0px", threshold: 0.01 },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, []);
  const updateFilters = (values: { q?: string; status?: string; page?: number }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (values.q !== undefined) values.q ? next.set("q", values.q) : next.delete("q");
      if (values.status !== undefined) values.status ? next.set("status", values.status) : next.delete("status");
      if (values.page !== undefined) values.page > 1 ? next.set("page", String(values.page)) : next.delete("page");
      return next;
    });
  };
  const pageHref = (targetPage: number) => {
    const next = new URLSearchParams(searchParams);
    targetPage > 1 ? next.set("page", String(targetPage)) : next.delete("page");
    const query = next.toString();
    return query ? `?${query}` : "";
  };
  const changeSort = (field: TaskSortField) => {
    const nextDirection: SortDirection = sort === field ? (direction === "asc" ? "desc" : "asc") : (field === "updated" ? "desc" : "asc");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (field === "updated" && nextDirection === "desc") {
        next.delete("sort");
        next.delete("direction");
      } else {
        next.set("sort", field);
        next.set("direction", nextDirection);
      }
      next.delete("page");
      return next;
    });
  };
  const sortHeader = (field: TaskSortField, label: string) => {
    const active = sort === field;
    const nextDirection: SortDirection = active && direction === "asc" ? "desc" : "asc";
    return <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className={`table-sort${active ? " active" : ""}`} type="button" title={t("tasks.sort.change", { column: label, direction: t(`tasks.sort.${nextDirection}`) })} onClick={() => changeSort(field)}>
        <span>{label}</span><span className="table-sort-icon" aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>;
  };

  if (!isSupportedLocale(locale)) return null;

  return (
    <div className={`page page-list reference-dashboard${showMobileCreate ? " mobile-create-visible" : ""}`}>
      <div className="page-header page-header-row">
        <div>
          <h1>{t("tasks.title")}</h1>
          <p>{t("tasks.subtitle")}</p>
        </div>
        <button ref={createButtonRef} className="button button-primary header-primary" type="button" disabled={createDraft.isPending} onClick={() => createDraft.mutate()}>
          {!createDraft.isPending && <span aria-hidden="true">＋</span>}
          {createDraft.isPending ? t("common.creating") : t("common.createTask")}
        </button>
      </div>

      <section className="reference-stat-row" aria-label={t("tasks.stats.label")}>
        <div className="reference-stat-card"><span>{t("tasks.stats.total")}</span><strong>{stats.data?.total ?? "—"}</strong></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.drafts")}</span><strong>{stats.data?.drafts ?? "—"}</strong></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.active")}</span><strong>{stats.data?.active ?? "—"}</strong></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.completed")}</span><strong>{stats.data?.completed ?? "—"}</strong></div>
      </section>

      {stats.isError && <div className="inline-error stat-error" role="alert">{localizedApiError(stats.error, t)} <button className="button button-secondary" type="button" onClick={() => void stats.refetch()}>{t("common.retry")}</button></div>}

      <section className="list-toolbar reference-toolbar" aria-label={t("nav.tasks")}>
        <form className="search-form" role="search" onSubmit={(event) => { event.preventDefault(); updateFilters({ q: searchInput.trim(), page: 1 }); }}>
          <label className="sr-only" htmlFor="task-search">{t("tasks.searchLabel")}</label>
          <input id="task-search" name="q" type="search" autoComplete="off" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("tasks.searchPlaceholder")} />
          <button className="button button-secondary" type="submit">{t("tasks.searchAction")}</button>
        </form>
        <label className="filter-control">
          <span className="sr-only">{t("tasks.filterLabel")}</span>
          <select name="status" autoComplete="off" value={status} onChange={(event) => updateFilters({ status: event.target.value, page: 1 })}>
            <option value="">{t("common.all")}</option>
            {options.data?.taskStatuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <span className="result-count" aria-live="polite">{t("tasks.count", { count: tasks.data?.total ?? 0 })}</span>
      </section>

      <section className="task-surface main-panel reference-table-panel" aria-busy={tasks.isPending}>
        {createDraft.isError && <div className="inline-error" role="alert">{localizedApiError(createDraft.error, t)}</div>}
        {deleteDraft.isError && <div className="inline-error" role="alert">{deleteDraft.error instanceof ApiError ? localizedApiError(deleteDraft.error, t) : t("tasks.deleteDraftFailed")}</div>}
        {options.isError && <div className="inline-error" role="alert">{localizedApiError(options.error, t)} <button className="button button-secondary" type="button" onClick={() => void options.refetch()}>{t("common.retry")}</button></div>}
        {tasks.isPending && <span className="sr-only" role="status">{t("common.loading")}</span>}
        {tasks.isError && <div className="inline-error" role="alert">{localizedApiError(tasks.error, t)} <button className="button button-secondary" type="button" onClick={() => void tasks.refetch()}>{t("common.retry")}</button></div>}
        {!tasks.isPending && tasks.data?.items.length === 0 && (
          <div className="empty-state">
            <div className="empty-folio" aria-hidden="true">01</div>
            <div><h2>{t("tasks.emptyTitle")}</h2><p>{t("tasks.emptyDescription")}</p></div>
            <button className="button button-primary" type="button" disabled={createDraft.isPending} onClick={() => createDraft.mutate()}>{createDraft.isPending ? t("common.creating") : t("common.createTask")}</button>
          </div>
        )}
        {(tasks.data?.items.length ?? 0) > 0 && (
          <div className="table-scroll">
            <table className="task-table data-table">
              <thead><tr>
                {sortHeader("project", t("tasks.columns.project"))}{sortHeader("author", t("tasks.columns.book"))}{sortHeader("status", t("tasks.columns.status"))}
                {sortHeader("updated", t("tasks.columns.updated"))}<th><span className="sr-only">{t("tasks.columns.action")}</span></th>
              </tr></thead>
              <tbody>{tasks.data?.items.map((task) => {
                const statusId = task.status === "draft" ? task.status : (task.workflowStatus ?? task.status);
                const statusOption = statusMap.get(statusId);
                const target = task.status === "draft" ? `/tasks/${task.id}/edit/project` : `/tasks/${task.id}`;
                const projectTitle = presentValue(task.bookTitle) ?? presentValue(task.projectName) ?? t("tasks.untitledDraft");
                const projectContext = presentValue(task.clientName) ?? presentValue(task.projectName) ?? t("tasks.pendingInput");
                const authorName = presentValue(task.authorName) ?? t("tasks.pendingInput");
                return <tr key={task.id}>
                  <td><Link className="task-identity" to={localizedPath(locale, target)}>
                    <ProjectCover coverUrl={task.coverUrl} pendingLabel={t("tasks.coverPending")} />
                    <span><strong>{projectTitle}</strong><small>{projectContext}</small></span>
                  </Link></td>
                  <td data-label={t("tasks.columns.book")}>{authorName}</td>
                  <td data-label={t("tasks.columns.status")}><span className={`status-badge status-${statusOption?.tone ?? "neutral"}`}>{statusOption?.label ?? statusId}</span></td>
                  <td data-label={t("tasks.columns.updated")}><time dateTime={task.updatedAt}>{formatter.format(new Date(task.updatedAt))}</time></td>
                  <td data-label={t("tasks.columns.action")}><div className="task-actions"><Link className="button button-secondary button-small" to={localizedPath(locale, target)}>{task.status === "draft" ? t("tasks.continueEditing") : t("tasks.view")}</Link>{task.status === "draft" && <button className="button button-quiet button-small task-delete" type="button" disabled={deleteDraft.isPending && deleteDraft.variables?.id === task.id} onClick={() => { if (window.confirm(t("tasks.deleteDraftConfirm"))) deleteDraft.mutate({ id: task.id, version: task.version }); }}>{deleteDraft.isPending && deleteDraft.variables?.id === task.id ? t("tasks.deletingDraft") : t("tasks.deleteDraft")}</button>}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {totalPages > 1 && <nav className="pagination" aria-label={t("common.paginationLabel")}>
        {page <= 1
          ? <span className="pagination-control pagination-arrow disabled" aria-disabled="true"><span aria-hidden="true">‹</span><span className="sr-only">{t("common.previous")}</span></span>
          : <Link className="pagination-control pagination-arrow" to={pageHref(page - 1)} rel="prev" aria-label={t("common.previous")}><span aria-hidden="true">‹</span></Link>}
        <ol className="pagination-pages">
          {buildPagination(page, totalPages).map((item) => typeof item === "number"
            ? <li key={item}>{item === page
              ? <span className="pagination-control current" aria-current="page" aria-label={t("common.currentPage", { page: item })}>{item}</span>
              : <Link className="pagination-control" to={pageHref(item)} aria-label={t("common.goToPage", { page: item })}>{item}</Link>}</li>
            : <li className="pagination-ellipsis" key={item} aria-hidden="true">…</li>)}
        </ol>
        {page >= totalPages
          ? <span className="pagination-control pagination-arrow disabled" aria-disabled="true"><span aria-hidden="true">›</span><span className="sr-only">{t("common.next")}</span></span>
          : <Link className="pagination-control pagination-arrow" to={pageHref(page + 1)} rel="next" aria-label={t("common.next")}><span aria-hidden="true">›</span></Link>}
        <span className="sr-only" role="status">{t("common.pageOf", { page, pages: totalPages })}</span>
      </nav>}
      {showMobileCreate ? (
        <button
          className="mobile-create-fab"
          type="button"
          aria-label={t("common.createTask")}
          aria-busy={createDraft.isPending}
          disabled={createDraft.isPending}
          onClick={() => createDraft.mutate()}
        >
          <span aria-hidden="true">＋</span>
        </button>
      ) : null}
    </div>
  );
}
