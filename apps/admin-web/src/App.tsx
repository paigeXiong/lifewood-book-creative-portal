import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminService, authService, localizedApiError, optionService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath, setLocale } from "@lifewood/i18n";
import type { AdminProjectDetail, AdminProjectSummary, AdminUser, ConfigOption, CurrentUser, ProjectPriority, SupportedLocale, WorkflowStatus } from "@lifewood/domain";
import { FinalDeliveryPanel } from "./FinalDeliveryPanel";
import { ModalFrame } from "./ModalFrame";
import { ChangeOwnPasswordDialog, ResetUserPasswordDialog } from "./PasswordDialogs";
import { VoiceConfigPage } from "./VoiceConfigPage";

import { FormOptionConfigPage } from "./FormOptionConfigPage";
import { FileCategoryConfigPage } from "./FileCategoryConfigPage";

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function adminAssetUrl(projectId: string, url: string) {
  const fileId = url.split("/").at(-1);
  return fileId ? `/api/admin/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}` : url;
}

export function customerPortalUrl(locale: SupportedLocale, configuredBase = import.meta.env.VITE_CUSTOMER_APP_URL): string {
  const base = configuredBase?.trim()
    || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5173` : "");
  return `${base.replace(/\/$/, "")}/${locale}/tasks`;
}

function adminUserAvatarUrl(userId: string) { return `/api/admin/users/${encodeURIComponent(userId)}/avatar`; }

function IdentityGate({ requiresBootstrap, busy, error, onAuthenticate }: { requiresBootstrap: boolean; busy: boolean; error?: string; onAuthenticate: (value: { displayName: string; email: string; password: string; rememberMe: boolean }) => void }) {
  const { t } = useTranslation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (requiresBootstrap && password !== String(data.get("confirmPassword") ?? "")) return;
    onAuthenticate({ displayName: String(data.get("displayName") ?? ""), email: String(data.get("email") ?? ""), password, rememberMe: data.get("rememberMe") === "on" });
  };
  return <main className="auth-screen"><section className="auth-card"><div className="auth-mark">LW</div><h1>{t(requiresBootstrap ? "admin.auth.bootstrapTitle" : "admin.auth.title")}</h1><p>{t(requiresBootstrap ? "admin.auth.bootstrapBody" : "admin.auth.body")}</p><form onSubmit={submit} aria-busy={busy}>
    {requiresBootstrap && <label><span>{t("admin.users.name")}</span><input name="displayName" autoComplete="name" minLength={2} maxLength={100} required /></label>}
    <label><span>{t("admin.users.email")}</span><input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
    <label><span>{t("admin.users.password")}</span><input name="password" type="password" autoComplete={requiresBootstrap ? "new-password" : "current-password"} minLength={requiresBootstrap ? 12 : undefined} maxLength={128} required /></label>
    {requiresBootstrap ? <label><span>{t("admin.users.confirmPassword")}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label> : <label className="check-row"><input name="rememberMe" type="checkbox" /><span>{t("admin.auth.remember")}</span></label>}
    {error && <div className="message error" role="alert">{error}</div>}
    <button className="primary" disabled={busy}>{t(busy ? "common.loading" : requiresBootstrap ? "admin.auth.createOwner" : "admin.auth.signIn")}</button>
  </form></section></main>;
}

function AdminShell({ user, locale, children }: { user: CurrentUser; locale: SupportedLocale; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const accountId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setAccountOpen(false); accountTriggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [accountOpen]);
  const logout = async () => {
    setLogoutPending(true);
    setLogoutFailed(false);
    try { await authService.logout(); queryClient.clear(); window.location.reload(); }
    catch { setLogoutFailed(true); setLogoutPending(false); }
  };
  const changeLocale = (next: string) => { if (isSupportedLocale(next)) navigate(window.location.pathname.replace(`/${locale}`, `/${next}`)); };
  return <div className="admin-shell"><aside className="sidebar"><div className="brand"><span>LW</span><div><strong>Lifewood</strong><small>{t("admin.productName")}</small></div></div><nav>
    <a href={customerPortalUrl(locale)}><span className="nav-icon" aria-hidden="true">←</span>{t("admin.nav.home")}</a>
    <NavLink to={localizedPath(locale, "/projects")}><span className="nav-icon">▤</span>{t("admin.nav.projects")}</NavLink>
    <NavLink to={localizedPath(locale, "/users")}><span className="nav-icon">◎</span>{t("admin.nav.users")}</NavLink>
    <NavLink to={localizedPath(locale, "/settings")}><span className="nav-icon" aria-hidden="true">⚙</span>{t("admin.nav.settings")}</NavLink>
  </nav></aside><div className="workspace"><header className="topbar"><span>{t("admin.internalWorkspace")}</span><div className="topbar-actions"><label><span className="sr-only">{t("nav.language")}</span><select value={locale} onChange={(event) => changeLocale(event.target.value)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label><div className="admin-account" ref={accountRef}><button ref={accountTriggerRef} className="admin-account-trigger" type="button" aria-expanded={accountOpen} aria-controls={accountId} aria-label={t("nav.accountMenu", { name: user.displayName })} onClick={() => setAccountOpen((value) => !value)}><img className="account-avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" /><span>{user.displayName}</span><span className="account-chevron" aria-hidden="true">⌄</span></button>{accountOpen && <div id={accountId} className="admin-account-popover" role="region" aria-label={t("nav.account")}><strong>{user.displayName}</strong>{user.email && <span>{user.email}</span>}<small>{user.roles.map((role) => t(`admin.roles.${role}`)).join(" · ")}</small><button onClick={() => { setAccountOpen(false); setChangePasswordOpen(true); }}>{t("admin.account.changePassword")}</button><button disabled={logoutPending} onClick={() => void logout()}>{t(logoutPending ? "nav.loggingOut" : "nav.logout")}</button>{logoutFailed && <p className="admin-account-error" role="alert">{t("nav.logoutFailed")}</p>}</div>}</div></div></header>{children}</div>{changePasswordOpen && <ChangeOwnPasswordDialog onClose={() => setChangePasswordOpen(false)} />}</div>;
}

function ProjectsPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowStatus | "">("");
  const [priority, setPriority] = useState<ProjectPriority | "">("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const projects = useQuery({ queryKey: ["admin-projects", workflow, priority, search, page], queryFn: () => adminService.listProjects({ workflowStatus: workflow || undefined, priority: priority || undefined, search: search || undefined, page, pageSize: 20 }) });
  const detail = useQuery({ queryKey: ["admin-project", selectedId], queryFn: () => adminService.getProject(selectedId!), enabled: Boolean(selectedId) });
  const staff = useQuery({ queryKey: ["admin-assignees"], queryFn: adminService.listAssignees });
  const options = useQuery({ queryKey: ["form-options", locale], queryFn: () => optionService.getFormOptions(locale) });
  const workflowOptions = options.data?.workflowStatuses ?? [];
  const priorityOptions = options.data?.projectPriorities ?? [];
  const workflowLabels = useMemo(() => new Map(workflowOptions.map((item) => [item.id, item.label])), [workflowOptions]);
  useEffect(() => { const items = projects.data?.items; if (!items?.length) setSelectedId(undefined); else if (!selectedId || !items.some((item) => item.id === selectedId)) setSelectedId(items[0].id); }, [projects.data?.items, selectedId]);
  const assignees = useMemo(() => staff.data ?? [], [staff.data]);
  const pages = Math.max(1, Math.ceil((projects.data?.total ?? 0) / 20));
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); };
  const updateWorkflow = useMutation({ mutationFn: (value: { workflowStatus: WorkflowStatus; priority: ProjectPriority; assigneeUserId?: string }) => adminService.updateWorkflow(selectedId!, value.workflowStatus, value.priority, value.assigneeUserId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-project"] }); await queryClient.invalidateQueries({ queryKey: ["admin-projects"] }); } });
  const addNote = useMutation({ mutationFn: (body: string) => adminService.addNote(selectedId!, body), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-project"] }); } });
  return <main className="content projects-content"><section className="page-toolbar"><form onSubmit={submitSearch} role="search"><input aria-label={t("admin.projects.search")} type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("admin.projects.search")} /><button>{t("common.search")}</button></form><select aria-label={t("admin.projects.statusFilter")} value={workflow} onChange={(event) => { setPage(1); setWorkflow(event.target.value as WorkflowStatus | ""); }}><option value="">{t("admin.projects.allStatuses")}</option>{workflowOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><select aria-label={t("admin.projects.priorityFilter")} value={priority} onChange={(event) => { setPage(1); setPriority(event.target.value as ProjectPriority | ""); }}><option value="">{t("admin.projects.allPriorities")}</option>{priorityOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><span className="result-count">{t("admin.projects.count", { count: projects.data?.total ?? 0 })}</span></section>
    <div className="master-detail"><section className="project-pane" aria-label={t("admin.projects.list")}>
      {projects.isError && <div className="message error">{localizedApiError(projects.error, t)}</div>}
      <div className="project-rows">{projects.data?.items.map((item) => <ProjectRow key={item.id} item={item} selected={item.id === selectedId} locale={locale} statusLabel={workflowLabels.get(item.workflowStatus) ?? item.workflowStatus} onSelect={() => setSelectedId(item.id)} />)}</div>
      {!projects.isPending && !projects.data?.items.length && <div className="empty">{t("admin.projects.empty")}</div>}
      <nav className="pager"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</button><span>{t("common.pageOf", { page, pages })}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</button></nav>
    </section><ProjectDetail detail={detail.data} loading={(detail.isPending && Boolean(selectedId)) || options.isPending} locale={locale} assignees={assignees} workflowOptions={workflowOptions} priorityOptions={priorityOptions} busy={updateWorkflow.isPending || addNote.isPending || options.isPending || options.isError || !workflowOptions.length || !priorityOptions.length} error={updateWorkflow.error ?? addNote.error ?? options.error} onWorkflow={(value) => updateWorkflow.mutate(value)} onNote={async (body) => { await addNote.mutateAsync(body); }} /></div>
  </main>;
}

function ProjectRow({ item, selected, locale, statusLabel, onSelect }: { item: AdminProjectSummary; selected: boolean; locale: SupportedLocale; statusLabel: string; onSelect: () => void }) {
  return <button className={selected ? "project-row selected" : "project-row"} onClick={onSelect}>{item.coverUrl ? <img src={adminAssetUrl(item.id, item.coverUrl)} alt="" /> : <span className="cover-placeholder" />}<span className="row-main"><strong>{item.projectName || item.bookTitle || "—"}</strong><small>{item.ownerName} · {item.bookTitle || "—"}</small><small>{item.taskNumber ?? item.id.slice(0, 8)} · {formatDate(item.updatedAt, locale)}</small></span><span className={`status status-${item.workflowStatus}`}>{statusLabel}</span></button>;
}

function ProjectDetail({ detail, loading, locale, assignees, workflowOptions, priorityOptions, busy, error, onWorkflow, onNote }: { detail?: AdminProjectDetail; loading: boolean; locale: SupportedLocale; assignees: AdminUser[]; workflowOptions: ConfigOption[]; priorityOptions: ConfigOption[]; busy: boolean; error: unknown; onWorkflow: (value: { workflowStatus: WorkflowStatus; priority: ProjectPriority; assigneeUserId?: string }) => void; onNote: (body: string) => Promise<void> }) {
  const { t } = useTranslation();
  if (loading) return <aside className="detail-pane empty">{t("common.loading")}</aside>;
  if (!detail) return <aside className="detail-pane empty">{t("admin.projects.select")}</aside>;
  const task = detail.project;
  const assets = [...task.book.sourceAssets, ...task.voiceAndReferences.assets];
  const saveWorkflow = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); onWorkflow({ workflowStatus: String(data.get("workflowStatus")) as WorkflowStatus, priority: String(data.get("priority")) as ProjectPriority, assigneeUserId: String(data.get("assigneeUserId") || "") || undefined }); };
  const saveNote = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("body") ?? "").trim(); if (body) void onNote(body).then(() => form.reset()); };
  return <aside className="detail-pane"><div className="detail-title"><div><span className="eyebrow">{task.taskNumber ?? task.id.slice(0, 8)}</span><h2>{task.project.projectName || task.book.title || "—"}</h2><p>{detail.ownerName} · {detail.ownerEmail}</p></div><span className={`status status-${detail.workflowStatus}`}>{workflowOptions.find((item) => item.id === detail.workflowStatus)?.label ?? detail.workflowStatus}</span></div>
    <form className="workflow-form" onSubmit={saveWorkflow} key={`${task.id}-${detail.workflowStatus}-${detail.priority}-${detail.assigneeUserId}`}><label><span>{t("admin.projects.workflow")}</span><select name="workflowStatus" defaultValue={detail.workflowStatus}>{workflowOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>{t("admin.projects.priority")}</span><select name="priority" defaultValue={detail.priority}>{priorityOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>{t("admin.projects.assignee")}</span><select name="assigneeUserId" defaultValue={detail.assigneeUserId ?? ""}><option value="">{t("admin.projects.unassigned")}</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><button className="primary" disabled={busy}>{t("common.save")}</button></form>
    {Boolean(error) && <div className="message error">{localizedApiError(error, t)}</div>}
    <FinalDeliveryPanel projectId={task.id} projectStatus={task.status} locale={locale} />
    <section className="detail-section"><h3>{t("admin.projects.clientBrief")}</h3><dl className="fact-grid"><div><dt>{t("wizard.fields.clientName")}</dt><dd>{task.project.clientName || "—"}</dd></div><div><dt>{t("wizard.fields.contactName")}</dt><dd>{task.project.contactName || "—"}</dd></div><div><dt>{t("wizard.fields.email")}</dt><dd>{task.project.email || "—"}</dd></div><div><dt>{t("wizard.fields.deadline")}</dt><dd>{task.project.deadline || "—"}</dd></div><div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{task.book.title || "—"}</dd></div><div><dt>{t("wizard.fields.authorName")}</dt><dd>{task.book.authorName || "—"}</dd></div><div className="wide"><dt>{t("wizard.fields.sellingPoint")}</dt><dd>{task.book.sellingPoint || "—"}</dd></div><div className="wide"><dt>{t("wizard.fields.synopsis")}</dt><dd>{task.book.synopsis || "—"}</dd></div></dl></section>
    <section className="detail-section"><h3>{t("admin.projects.files", { count: assets.length })}</h3>{assets.length ? <ul className="file-list">{assets.map((asset) => <li key={asset.id}><a href={adminAssetUrl(task.id, asset.url)} target="_blank" rel="noreferrer">{asset.fileName}</a><small>{asset.categoryId}</small></li>)}</ul> : <p className="muted">{t("admin.projects.noFiles")}</p>}</section>
    <section className="detail-section notes"><h3>{t("admin.projects.notes")}</h3><form onSubmit={saveNote}><textarea name="body" rows={2} maxLength={4000} required placeholder={t("admin.projects.notePlaceholder")} /><button disabled={busy}>{t("admin.projects.addNote")}</button></form>{detail.notes.length ? <ol>{detail.notes.map((note) => <li key={note.id}><p>{note.body}</p><small>{note.authorName} · {formatDate(note.createdAt, locale)}</small></li>)}</ol> : <p className="muted">{t("admin.projects.noNotes")}</p>}</section>
  </aside>;
}

function UsersPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState<AdminUser>();
  const users = useQuery({ queryKey: ["admin-users", search, role, page], queryFn: () => adminService.listUsers({ search: search || undefined, role: role || undefined, page, pageSize: 20 }) });
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / 20));
  const create = useMutation({ mutationFn: adminService.createUser, onSuccess: async () => { setShowCreate(false); await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); } });
  const update = useMutation({ mutationFn: ({ id, displayName, role, active }: { id: string; displayName: string; role: "customer" | "admin"; active: boolean }) => adminService.updateUser(id, { displayName, role, active }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); } });
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); };
  return <main className="content users-content"><section className="page-toolbar"><form onSubmit={submitSearch} role="search"><input aria-label={t("admin.users.search")} type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("admin.users.search")} /><button>{t("common.search")}</button></form><select aria-label={t("admin.users.roleFilter")} value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}><option value="">{t("admin.users.allRoles")}</option><option value="customer">{t("admin.roles.customer")}</option><option value="admin">{t("admin.roles.admin")}</option><option value="owner">{t("admin.roles.owner")}</option></select><span className="result-count">{t("admin.users.count", { count: users.data?.total ?? 0 })}</span><button className="primary push-right" onClick={() => setShowCreate(true)}>{t("admin.users.create")}</button></section>
    {Boolean(users.error || update.error) && <div className="message error">{localizedApiError(users.error ?? update.error, t)}</div>}
    <section className="table-card"><table><thead><tr><th>{t("admin.users.account")}</th><th>{t("admin.users.role")}</th><th>{t("admin.users.status")}</th><th>{t("admin.users.created")}</th><th>{t("admin.users.action")}</th></tr></thead><tbody>{users.data?.items.map((user) => <tr key={user.id}><td><div className="user-cell"><img src={adminUserAvatarUrl(user.id)} alt="" width="32" height="32" /><div><strong>{user.displayName}</strong><small>{user.email}</small></div></div></td><td>{t(`admin.roles.${user.role}`)}</td><td><span className={user.active ? "status active" : "status inactive"}>{t(user.active ? "admin.users.active" : "admin.users.inactive")}</span></td><td>{formatDate(user.createdAt, locale)}</td><td>{user.role === "owner" ? <span className="muted">{t("admin.users.protected")}</span> : <div className="row-actions"><button onClick={() => setResetUser(user)}>{t("admin.users.resetPassword")}</button><button disabled={update.isPending} onClick={() => update.mutate({ id: user.id, displayName: user.displayName, role: user.role as "customer" | "admin", active: !user.active })}>{t(user.active ? "admin.users.deactivate" : "admin.users.activate")}</button></div>}</td></tr>)}</tbody></table>{!users.isPending && !users.data?.items.length && <div className="empty">{t("admin.users.empty")}</div>}<nav className="pager"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</button><span>{t("common.pageOf", { page, pages })}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</button></nav></section>
    {showCreate && <CreateUserDialog busy={create.isPending} error={create.error} onClose={() => setShowCreate(false)} onCreate={(value) => create.mutate(value)} />}
    {resetUser && <ResetUserPasswordDialog user={resetUser} onClose={() => setResetUser(undefined)} />}
  </main>;
}

function CreateUserDialog({ busy, error, onClose, onCreate }: { busy: boolean; error: unknown; onClose: () => void; onCreate: (value: { displayName: string; email: string; password: string; role: "customer" | "admin" }) => void }) {
  const { t } = useTranslation();
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); onCreate({ displayName: String(data.get("displayName")), email: String(data.get("email")), password: String(data.get("password")), role: String(data.get("role")) as "customer" | "admin" }); };
  return <ModalFrame labelledBy="create-user-title" busy={busy} onClose={onClose}><div className="modal-title"><h2 id="create-user-title">{t("admin.users.create")}</h2><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></div><form onSubmit={submit}><label><span>{t("admin.users.name")}</span><input name="displayName" minLength={2} maxLength={100} required autoFocus /></label><label><span>{t("admin.users.email")}</span><input name="email" type="email" maxLength={254} required /></label><label><span>{t("admin.users.password")}</span><input name="password" type="password" minLength={12} maxLength={128} required /><small>{t("admin.users.passwordHint")}</small></label><label><span>{t("admin.users.role")}</span><select name="role" defaultValue="customer"><option value="customer">{t("admin.roles.customer")}</option><option value="admin">{t("admin.roles.admin")}</option></select></label>{Boolean(error) && <div className="message error">{localizedApiError(error, t)}</div>}<div className="modal-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "common.loading" : "admin.users.createAction")}</button></div></form></ModalFrame>;
}

function AdminRoot() {
  const { locale: routeLocale } = useParams();
  const locale: SupportedLocale = isSupportedLocale(routeLocale) ? routeLocale : "zh-CN";
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { void setLocale(locale); document.documentElement.lang = locale; document.title = t("admin.documentTitle"); }, [locale, t]);
  const me = useQuery({ queryKey: ["admin-me"], queryFn: authService.getCurrentUser, retry: false });
  const authStatus = useQuery({ queryKey: ["auth-status"], queryFn: authService.getStatus, enabled: me.isError, retry: false });
  const authenticate = async (value: { displayName: string; email: string; password: string; rememberMe: boolean }) => { setBusy(true); setError(undefined); try { if (authStatus.data?.requiresBootstrap) await authService.bootstrap(value); else await authService.login(value); await queryClient.invalidateQueries(); } catch (reason) { setError(localizedApiError(reason, t)); } finally { setBusy(false); } };
  if (me.isPending || (me.isError && authStatus.isPending)) return <main className="center-state">{t("common.loading")}</main>;
  if (!me.data) return <IdentityGate requiresBootstrap={authStatus.data?.requiresBootstrap === true} busy={busy} error={error} onAuthenticate={(value) => void authenticate(value)} />;
  if (!me.data.permissions.includes("admin.access")) return <main className="center-state"><div><h1>{t("admin.forbidden.title")}</h1><p>{t("admin.forbidden.body")}</p><button onClick={() => void authService.logout().then(() => window.location.reload())}>{t("nav.logout")}</button></div></main>;
  return <AdminShell user={me.data} locale={locale}><Routes><Route index element={<Navigate replace to="projects" />} /><Route path="projects" element={<ProjectsPage locale={locale} />} /><Route path="users" element={<UsersPage locale={locale} />} /><Route path="settings" element={<Navigate replace to="options" />} /><Route path="settings/options" element={<FormOptionConfigPage locale={locale} />} /><Route path="settings/files" element={<FileCategoryConfigPage locale={locale} />} /><Route path="settings/voices" element={<VoiceConfigPage locale={locale} />} /><Route path="voices" element={<Navigate replace to={localizedPath(locale, "/settings/voices")} />} /><Route path="*" element={<Navigate replace to="projects" />} /></Routes></AdminShell>;
}

export function App() {
  return <Routes><Route path="/" element={<Navigate replace to="/zh-CN/projects" />} /><Route path="/:locale/*" element={<AdminRoot />} /><Route path="*" element={<Navigate replace to="/zh-CN/projects" />} /></Routes>;
}
