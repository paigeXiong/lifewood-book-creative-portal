import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, authService, localAuthService, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath, setLocale } from "@lifewood/i18n";
import type { ConfigOption, CurrentUser, SupportedLocale, TaskDraft, TaskSummary } from "@lifewood/domain";

const PAGE_SIZE = 12;

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function optionLabel(items: ConfigOption[] | undefined, id: string | undefined) {
  return items?.find((item) => item.id === id)?.label ?? id ?? "—";
}

function IdentityGate({ users, busy, error, onLogin }: { users: CurrentUser[]; busy: boolean; error?: string; onLogin: (id: string) => void }) {
  const { t } = useTranslation();
  return <main className="identity-screen">
    <section className="identity-panel" aria-labelledby="identity-title">
      <div className="test-flag">{t("testConsole.removable")}</div>
      <h1 id="identity-title">{t("testConsole.identityTitle")}</h1>
      <p>{t("testConsole.identityHint")}</p>
      {error && <div className="console-error" role="alert">{error}</div>}
      <div className="identity-list">{users.map((user) => <button key={user.id} disabled={busy} onClick={() => onLogin(user.id)}>
        <span className="identity-avatar">{user.displayName.slice(0, 1)}</span><span><strong>{user.displayName}</strong><small>{user.organization?.name ?? user.email ?? user.id}</small></span>
      </button>)}</div>
      {!users.length && <div className="empty-note">{t("auth.noUsers")}</div>}
    </section>
  </main>;
}

function ProjectDetail({ project, locale, statuses, genres }: { project?: TaskDraft; locale: SupportedLocale; statuses?: ConfigOption[]; genres?: ConfigOption[] }) {
  const { t } = useTranslation();
  if (!project) return <aside className="detail-panel empty-detail"><p>{t("testConsole.selectProject")}</p></aside>;
  const assets = [...project.book.sourceAssets, ...project.voiceAndReferences.assets];
  const status = statuses?.find((item) => item.id === project.status);
  return <aside className="detail-panel" aria-label={t("testConsole.detailTitle")}>
    <div className="detail-heading"><div><span className={`status-pill status-${status?.tone ?? "neutral"}`}>{status?.label ?? project.status}</span><h2>{project.project.projectName || project.book.title || "—"}</h2></div><small>{project.taskNumber ?? project.id.slice(0, 8)}</small></div>
    <dl className="detail-grid">
      <div><dt>{t("wizard.fields.clientName")}</dt><dd>{project.project.clientName || "—"}</dd></div>
      <div><dt>{t("wizard.fields.contactName")}</dt><dd>{project.project.contactName || "—"}</dd></div>
      <div><dt>{t("wizard.fields.email")}</dt><dd>{project.project.email || "—"}</dd></div>
      <div><dt>{t("wizard.fields.deadline")}</dt><dd>{project.project.deadline || "—"}</dd></div>
      <div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{project.book.title || "—"}</dd></div>
      <div><dt>{t("wizard.fields.authorName")}</dt><dd>{project.book.authorName || "—"}</dd></div>
      <div><dt>{t("wizard.fields.genre")}</dt><dd>{optionLabel(genres, project.book.genreId)}</dd></div>
      <div><dt>{t("testConsole.characters")}</dt><dd>{project.creative.characters.length}</dd></div>
      <div><dt>{t("taskDetail.created")}</dt><dd>{formatDate(project.createdAt, locale)}</dd></div>
      <div><dt>{t("tasks.columns.updated")}</dt><dd>{formatDate(project.updatedAt, locale)}</dd></div>
    </dl>
    <section className="asset-section"><h3>{t("testConsole.receivedFiles", { count: assets.length })}</h3>{assets.length ? <ul>{assets.map((asset) => <li key={asset.id}><a href={asset.url} target="_blank" rel="noreferrer">{asset.fileName}</a><small>{asset.categoryId}</small></li>)}</ul> : <p>{t("testConsole.noFiles")}</p>}</section>
    <section className="readonly-note"><strong>{t("testConsole.readonlyTitle")}</strong><p>{t("testConsole.readonlyBody")}</p></section>
  </aside>;
}

function ConsolePage() {
  const { locale: routeLocale } = useParams();
  const locale: SupportedLocale = isSupportedLocale(routeLocale) ? routeLocale : "zh-CN";
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string>();

  useEffect(() => { void setLocale(locale); document.title = t("testConsole.documentTitle"); }, [locale, t]);
  const me = useQuery({ queryKey: ["test-console-user"], queryFn: authService.getCurrentUser });
  const users = useQuery({ queryKey: ["test-console-users"], queryFn: localAuthService.listUsers, enabled: me.error instanceof ApiError && me.error.details.code === "auth.unauthorized" });
  const options = useQuery({ queryKey: ["test-console-options", locale], queryFn: () => optionService.getFormOptions(locale), enabled: Boolean(me.data) });
  const projects = useQuery({ queryKey: ["test-console-projects", locale, status, search, page], queryFn: () => projectService.listProjects({ locale, status: status || undefined, search: search || undefined, page, pageSize: PAGE_SIZE }), enabled: Boolean(me.data) });
  const detail = useQuery({ queryKey: ["test-console-project", selectedId, locale], queryFn: () => projectService.getProject(selectedId!, locale), enabled: Boolean(me.data && selectedId) });

  useEffect(() => {
    const items = projects.data?.items;
    if (!items?.length) { setSelectedId(undefined); return; }
    if (!selectedId || !items.some((item) => item.id === selectedId)) setSelectedId(items[0].id);
  }, [projects.data?.items, selectedId]);

  const pages = Math.max(1, Math.ceil((projects.data?.total ?? 0) / PAGE_SIZE));
  const statusMap = useMemo(() => new Map(options.data?.taskStatuses.map((item) => [item.id, item]) ?? []), [options.data?.taskStatuses]);

  const login = async (id: string) => {
    setLoginBusy(true); setLoginError(undefined);
    try { await localAuthService.login(id); await queryClient.invalidateQueries(); }
    catch (error) { setLoginError(localizedApiError(error, t)); }
    finally { setLoginBusy(false); }
  };
  const logout = async () => { await localAuthService.logout(); queryClient.clear(); window.location.reload(); };
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); };
  const changeLocale = (next: string) => { if (isSupportedLocale(next)) navigate(localizedPath(next, "")); };

  if (me.isPending) return <main className="center-state">{t("common.loading")}</main>;
  if (!me.data) return <IdentityGate users={users.data ?? []} busy={loginBusy} error={loginError ?? (users.error ? localizedApiError(users.error, t) : undefined)} onLogin={(id) => void login(id)} />;

  return <div className="console-shell">
    <header className="console-header"><div><strong>{t("testConsole.title")}</strong><span className="test-flag">{t("testConsole.removable")}</span></div><div className="header-actions"><label>{t("nav.language")}<select value={locale} onChange={(event) => changeLocale(event.target.value)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label><span>{me.data.displayName}</span><button onClick={() => void logout()}>{t("nav.logout")}</button></div></header>
    <main className="console-main">
      <section className="list-panel" aria-label={t("testConsole.listTitle")}>
        <form className="console-toolbar" onSubmit={submitSearch}><label className="search-field"><span>{t("tasks.searchLabel")}</span><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("tasks.searchPlaceholder")} /></label><button type="submit">{t("tasks.searchAction")}</button><label><span>{t("tasks.filterLabel")}</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t("common.all")}</option>{options.data?.taskStatuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" onClick={() => void projects.refetch()}>{t("testConsole.refresh")}</button></form>
        <div className="list-meta"><strong>{t("testConsole.receivedCount", { count: projects.data?.total ?? 0 })}</strong>{projects.isFetching && <span>{t("common.loading")}</span>}</div>
        {projects.error && <div className="console-error" role="alert">{localizedApiError(projects.error, t)}</div>}
        <div className="project-list">{projects.data?.items.map((item: TaskSummary) => <button className={selectedId === item.id ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
          {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <span className="cover-space" aria-hidden="true" />}
          <span className="project-copy"><strong>{item.projectName || item.bookTitle || "—"}</strong><small>{item.bookTitle || "—"} · {item.authorName || "—"}</small><small>{item.taskNumber ?? item.id.slice(0, 8)} · {formatDate(item.updatedAt, locale)}</small></span><span className={`status-pill status-${statusMap.get(item.status)?.tone ?? "neutral"}`}>{statusMap.get(item.status)?.label ?? item.status}</span>
        </button>)}</div>
        {!projects.isPending && !projects.data?.items.length && <div className="empty-note">{t("testConsole.empty")}</div>}
        <nav className="pager" aria-label={t("common.pageOf", { page, pages })}><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</button><span>{t("common.pageOf", { page, pages })}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</button></nav>
      </section>
      {detail.error ? <aside className="detail-panel"><div className="console-error" role="alert">{localizedApiError(detail.error, t)}</div></aside> : <ProjectDetail project={detail.data} locale={locale} statuses={options.data?.taskStatuses} genres={options.data?.genres} />}
    </main>
  </div>;
}

export function App() {
  return <Routes><Route path="/" element={<Navigate replace to="/zh-CN" />} /><Route path="/:locale" element={<ConsolePage />} /><Route path="*" element={<Navigate replace to="/zh-CN" />} /></Routes>;
}
