import {SavedViews} from "@lifewood/ui/saved-views";
import {personalWorkspaceService} from "@lifewood/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, authService, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { ProjectCoverImage } from "../components/ProjectCoverImage";
import { DeleteDraftDialog } from "../components/DeleteDraftDialog";
import { TaskFilters } from "../components/TaskFilters";
import { buildPagination } from "../pagination";

function TaskStatIcon({ kind }: { kind: "total" | "drafts" | "active" | "completed" | "actionRequired" }) {
  return <svg className="reference-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "total" && <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
    {kind === "drafts" && <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="m16 3 5 5-9 9-6 1 1-6 9-9Z M13 6l5 5" /></>}
    {kind === "active" && <><path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5" /></>}
    {kind === "actionRequired" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
    {kind === "completed" && <><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></>}
  </svg>;
}

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
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const requestedSort = searchParams.get("sort");
  const sort: TaskSortField = taskSortFields.includes(requestedSort as TaskSortField) ? requestedSort as TaskSortField : "updated";
  const direction: SortDirection = searchParams.get("direction") === "asc" ? "asc" : "desc";
  const [showMobileCreate, setShowMobileCreate] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";

  const options = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const tasks = useQuery({
    queryKey: ["projects", validLocale, status, search, sort, direction, page],
    queryFn: () => projectService.listProjects({ locale: validLocale, status: status || undefined, search: search || undefined, sort, direction, page, pageSize: 10 }),
  });
  const resumeIds=tasks.data?.items.filter(task=>task.status==="draft").map(task=>task.id)??[];
  const resume=useQuery({queryKey:["project-resume",resumeIds],queryFn:()=>personalWorkspaceService.resumeSteps(resumeIds),enabled:resumeIds.length>0,staleTime:0});
  const stats = useQuery({ queryKey: ["project-stats"], queryFn: projectService.getStats });
  const account = useQuery({ queryKey: ["current-user"], queryFn: authService.getCurrentUser, retry: false });
  const hasOrganization = Boolean(account.data?.organization?.id && account.data.organization.name.trim());
  const canCreate = account.isSuccess && hasOrganization;
  const organizationNotice = account.isSuccess && !hasOrganization ? "task-organization-required" : undefined;
  const createDraft = useMutation({
    mutationFn: () => projectService.createDraft(validLocale),
    onError: error => {
      if (error instanceof ApiError && error.details.code === "project.organization_required") void queryClient.invalidateQueries({ queryKey: ["current-user"] });
    },
    onSuccess: async (draft) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project-stats"] }),
      ]);
      navigate(localizedPath(validLocale, `/tasks/${draft.id}/edit/project`));
    },
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; version: number; title: string; returned: boolean } | null>(null);
  const deletingRef = useRef(false);
  const deleteDraft = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => projectService.deleteDraft(id, version, validLocale),
    onSettled: () => { deletingRef.current = false; },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      setDeleteTarget(null);
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
  const changeSort = (field: TaskSortField, selectedDirection?: SortDirection) => {
    const nextDirection: SortDirection = selectedDirection ?? (sort === field ? (direction === "asc" ? "desc" : "asc") : (field === "updated" ? "desc" : "asc"));
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
    const nextDirection: SortDirection = active ? (direction === "asc" ? "desc" : "asc") : (field === "updated" ? "desc" : "asc");
    return <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className={`table-sort${active ? " active" : ""}`} type="button" title={t("tasks.sort.change", { column: label, direction: t(`tasks.sort.${nextDirection}`) })} onClick={() => changeSort(field)}>
        <span>{label}</span><span className="table-sort-icon" aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>;
  };

  const statusLabel = status === "action_required" ? t("clientUx.actionRequired") : statusMap.get(status)?.label ?? t("tasks.filterLabel");
  const filtered = Boolean(search || status);
  // The attention tab already represents this status; do not repeat it below the toolbar.
  const chipStatus = status && status !== "action_required";
  const hasFilterChips = Boolean(search || chipStatus);
  const emptyKind = search ? "noResults" : status === "action_required" ? "noAction" : status ? "noResults" : "new";
  const clearFilters = () => { setSearchDraft(""); updateFilters({ q: "", status: "", page: 1 }); };
  const sortLabel = (field: TaskSortField) => t(`tasks.columns.${field === "author" ? "book" : field}`);

  if (!isSupportedLocale(locale)) return null;

  return (
    <div className={`page page-list reference-dashboard${showMobileCreate ? " mobile-create-visible" : ""}`}>
      <h1 className="sr-only">{t("tasks.title")}</h1>

      <section className="reference-stat-row" aria-label={t("tasks.stats.label")}>
        <div className="reference-stat-card"><span>{t("tasks.stats.total")}</span><strong>{stats.data?.total ?? "—"}</strong><TaskStatIcon kind="total" /></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.actionRequired")}</span><strong>{stats.data?.actionRequired ?? "—"}</strong><TaskStatIcon kind="actionRequired" /></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.drafts")}</span><strong>{stats.data?.drafts ?? "—"}</strong><TaskStatIcon kind="drafts" /></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.active")}</span><strong>{stats.data?.active ?? "—"}</strong><TaskStatIcon kind="active" /></div>
        <div className="reference-stat-card"><span>{t("tasks.stats.completed")}</span><strong>{stats.data?.completed ?? "—"}</strong><TaskStatIcon kind="completed" /></div>
      </section>

      {stats.isError && <div className="inline-error stat-error" role="alert">{localizedApiError(stats.error, t)} <button className="button button-secondary" type="button" onClick={() => void stats.refetch()}>{t("common.retry")}</button></div>}

      <section className="task-surface main-panel reference-table-panel" aria-busy={tasks.isPending}>
        {organizationNotice && <p id={organizationNotice} className="task-creation-note" role="status">{t("errors.project.organizationRequired")}</p>}
        {account.isError && <div className="inline-error" role="alert">{localizedApiError(account.error, t)} <button className="button button-secondary" type="button" onClick={() => void account.refetch()}>{t("common.retry")}</button></div>}
        {createDraft.isError && <div className="inline-error" role="alert">{localizedApiError(createDraft.error, t)}</div>}
        {options.isError && <div className="inline-error" role="alert">{localizedApiError(options.error, t)} <button className="button button-secondary" type="button" onClick={() => void options.refetch()}>{t("common.retry")}</button></div>}
        {tasks.isPending && <span className="sr-only" role="status">{t("common.loading")}</span>}
        {tasks.isError && <div className="inline-error" role="alert">{localizedApiError(tasks.error, t)} <button className="button button-secondary" type="button" onClick={() => void tasks.refetch()}>{t("common.retry")}</button></div>}
          <div className="task-list-toolbar">
          <div className="task-list-navigation">
            <div className="task-attention-tabs" aria-label={t("tasks.filterLabel")}>
              <button type="button" aria-pressed={status!=="action_required"} onClick={()=>updateFilters({status:"",page:1})}>{t("clientUx.allProjects")}</button>
              <button type="button" aria-pressed={status==="action_required"} onClick={()=>updateFilters({status:"action_required",page:1})}>{t("clientUx.actionRequired")}</button>
            </div>
            <span className="task-result-count" role="status">{tasks.data && t("tasks.count", { count: tasks.data.total })}</span>

          </div>
            <form className="task-search" role="search" aria-label={t("tasks.searchLabel")} onSubmit={event => { event.preventDefault(); updateFilters({ q: searchDraft.trim(), page: 1 }); }}>
              <input type="search" aria-label={t("tasks.searchLabel")} placeholder={t("tasks.searchPlaceholder")} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} />
            </form>
            <div className="task-table-controls">
              <TaskFilters status={status} statuses={options.data?.taskStatuses ?? []} onApply={updateFilters} />
          <SavedViews key={account.data?.id} userId={account.data?.id} area="tasks" filters={{q:search,status,sort,direction}} onApply={values=>setSearchParams(new URLSearchParams(values))}/>

            <label className="task-mobile-sort">
              <span className="sr-only">{t("tasks.listUx.sortLabel")}</span>
              <select value={`${sort}:${direction}`} onChange={event => { const [field, order] = event.target.value.split(":"); changeSort(field as TaskSortField, order as SortDirection); }}>
                {taskSortFields.map(field => (["asc", "desc"] as const).map(order => <option key={`${field}:${order}`} value={`${field}:${order}`}>{t("tasks.listUx.sortOption", { column: sortLabel(field), direction: t(`tasks.sort.${order}`) })}</option>))}
              </select>
            </label>
              <button ref={createButtonRef} className="button button-primary task-create-button" type="button" disabled={createDraft.isPending || !canCreate} aria-describedby={organizationNotice} onClick={() => { if (canCreate) createDraft.mutate(); }}>
                {!createDraft.isPending && <span aria-hidden="true">＋</span>}
                {createDraft.isPending ? t("common.creating") : t("common.createTask")}
              </button>
            </div>
          </div>
          {hasFilterChips && <div className="task-filter-chips" aria-label={t("tasks.listUx.activeFilters")}>
            {search && <button type="button" className="task-filter-chip" aria-label={t("tasks.listUx.removeSearch", { value: search })} onClick={() => updateFilters({ q: "", page: 1 })}><span>{t("tasks.filters.keyword")}: {search}</span><span aria-hidden="true">×</span></button>}
            {chipStatus && <button type="button" className="task-filter-chip" aria-label={t("tasks.listUx.removeStatus", { value: statusLabel })} onClick={() => updateFilters({ status: "", page: 1 })}><span>{statusLabel}</span><span aria-hidden="true">×</span></button>}
            <button type="button" className="button button-quiet task-clear-filters" onClick={clearFilters}>{t("tasks.listUx.clearAll")}</button>
          </div>}
          <div className="table-scroll">
            <table className="task-table data-table">
              <thead><tr>
                {sortHeader("project", t("tasks.columns.project"))}{sortHeader("author", t("tasks.columns.book"))}{sortHeader("status", t("tasks.columns.status"))}
                {sortHeader("updated", t("tasks.columns.updated"))}
                <th>{t("tasks.columns.action")}</th>
              </tr></thead>
              <tbody>
                {tasks.isPending && Array.from({ length: 4 }, (_, row) => (
                  <tr key={`loading-${row}`} className="task-loading-row" aria-hidden="true">
                    {Array.from({ length: 5 }, (_, column) => <td key={column}><span className="task-loading-placeholder" /></td>)}
                  </tr>
                ))}
                {!tasks.isPending && tasks.data?.items.length === 0 && (
                  <tr className="task-empty-row"><td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-folio" aria-hidden="true">{emptyKind === "noAction" ? "✓" : emptyKind === "noResults" ? "⌕" : "01"}</div>
                      <div><h2>{t(emptyKind === "new" ? "tasks.emptyTitle" : `tasks.listUx.${emptyKind}Title`)}</h2><p>{t(emptyKind === "new" ? "tasks.emptyDescription" : `tasks.listUx.${emptyKind}Description`)}</p>
                        {filtered ? <button className="button button-secondary" type="button" onClick={clearFilters}>{t(emptyKind === "noAction" ? "clientUx.allProjects" : "tasks.listUx.clearAll")}</button> : <button className="button button-primary" type="button" disabled={createDraft.isPending || !canCreate} aria-describedby={organizationNotice} onClick={() => { if (canCreate) createDraft.mutate(); }}>{t(createDraft.isPending ? "common.creating" : "common.createTask")}</button>}
                      </div>
                    </div>
                  </td></tr>
                )}
                {tasks.data?.items.map((task) => {
                const returned = task.status === "draft" && task.workflowStatus === "awaiting_customer";
                const statusId = returned ? "awaiting_customer" : task.status === "draft" ? task.status : (task.workflowStatus ?? task.status);
                const statusOption = statusMap.get(statusId);
                const target = task.status === "draft" ? `/tasks/${task.id}/edit/${resume.data?.find(item=>item.projectId===task.id)?.step??"project"}` : `/tasks/${task.id}`;
                const projectTitle = presentValue(task.bookTitle) ?? presentValue(task.projectName) ?? t("tasks.untitledDraft");
                const projectContext = presentValue(task.clientName) ?? presentValue(task.projectName) ?? t("tasks.pendingInput");
                const authorName = presentValue(task.authorName) ?? t("tasks.pendingInput");
                return <tr key={task.id}>
                  <td><Link className="task-identity" to={localizedPath(locale, target)}>
                    <ProjectCover coverUrl={task.coverUrl} pendingLabel={t("tasks.coverPending")} />
                    <span><strong>{projectTitle}</strong><small>{projectContext}</small></span>
                  </Link></td>
                  <td data-label={t("tasks.columns.book")}>{authorName}</td>
                  <td data-label={t("tasks.columns.status")}><span className={`status-badge status-${returned ? "danger" : statusOption?.tone ?? "neutral"}`}>{returned ? t("clientUx.returnedStatus") : statusOption?.label ?? statusId}</span></td>
                  <td data-label={t("tasks.columns.updated")}><time dateTime={task.updatedAt}>{formatter.format(new Date(task.updatedAt))}</time></td>
                  <td data-label={t("tasks.columns.action")}><div className="task-actions"><Link className="button button-secondary button-small" to={localizedPath(locale, target)}>{t(returned ? "clientUx.handleReturn" : task.status === "draft" ? "clientUx.continueDraft" : "clientUx.viewProgress")}</Link>{task.status === "draft" && <details className="task-more"><summary aria-label={t("clientUx.more")} data-icon-motion="pop"><span aria-hidden="true" data-icon-glyph>···</span></summary><button className="button button-quiet button-small task-delete" type="button" disabled={deleteDraft.isPending && deleteDraft.variables?.id === task.id} onClick={() => { deleteDraft.reset(); setDeleteTarget({ id: task.id, version: task.version, title: projectTitle, returned }); }}>{deleteDraft.isPending && deleteDraft.variables?.id === task.id ? t("tasks.deletingDraft") : t(returned ? "tasks.deleteReturned" : "tasks.deleteDraft")}</button></details>}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
      </section>

      {deleteTarget && <DeleteDraftDialog returned={deleteTarget.returned} title={deleteTarget.title} busy={deleteDraft.isPending} fallbackFocusRef={createButtonRef}
        error={deleteDraft.isError ? (deleteDraft.error instanceof ApiError ? localizedApiError(deleteDraft.error, t) : t("tasks.deleteDraftFailed")) : undefined}
        onClose={() => { if (!deletingRef.current) setDeleteTarget(null); }}
        onConfirm={() => {
          if (deletingRef.current) return;
          deletingRef.current = true;
          deleteDraft.mutate({ id: deleteTarget.id, version: deleteTarget.version });
        }}
      />}

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
          disabled={createDraft.isPending || !canCreate} aria-describedby={organizationNotice}
          onClick={() => { if (canCreate) createDraft.mutate(); }}
         data-icon-motion="press">
          <span aria-hidden="true">＋</span>
        </button>
      ) : null}
    </div>
  );
}
