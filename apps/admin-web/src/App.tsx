import {
  useEffect,
  useId,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  adminService,
  ApiError,
  authService,
  localizedApiError,
  optionService,
} from "@lifewood/api-client";
import { isSupportedLocale, localizedPath, setLocale } from "@lifewood/i18n";
import type {
  AdminProjectDetail,
  AdminProjectSummary,
  AdminOrganization,
  AdminUser,
  AdminVoiceReference,
  ConfigOption,
  CurrentUser,
  FormOptions,
  ProjectPriority,
  ReferenceAsset,
  SupportedLocale,
  WorkflowStatus,
} from "@lifewood/domain";
import { getNarrationEnabled } from "@lifewood/domain";
import { FinalDeliveryPanel } from "./FinalDeliveryPanel";
import { ModalFrame } from "./ModalFrame";
import {
  ChangeOwnPasswordDialog,
  ResetUserPasswordDialog,
} from "./PasswordDialogs";
import { showAdminToast, ToastHost } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";
import { loadAllOrganizations } from "./organization-loader";

const AvatarEditor = lazy(() => import("@lifewood/ui/avatar-editor").then((module) => ({ default: module.AvatarEditor })));
const OverviewPage = lazy(() => import("./OverviewPage").then((module) => ({ default: module.OverviewPage })));
const OrganizationsPage = lazy(() => import("./OrganizationsPage").then((module) => ({ default: module.OrganizationsPage })));
const AuditPage = lazy(() => import("./AuditPage").then((module) => ({ default: module.AuditPage })));
const FormOptionConfigPage = lazy(() => import("./FormOptionConfigPage").then((module) => ({ default: module.FormOptionConfigPage })));
const FileCategoryConfigPage = lazy(() => import("./FileCategoryConfigPage").then((module) => ({ default: module.FileCategoryConfigPage })));
const VoiceConfigPage = lazy(() => import("./VoiceConfigPage").then((module) => ({ default: module.VoiceConfigPage })));
const AiSettingsPage = lazy(() => import("./AiSettingsPage").then(module => ({ default: module.AiSettingsPage })));
const SystemRuntimePage = lazy(() => import("./SystemRuntimePage").then((module) => ({ default: module.SystemRuntimePage })));

type AdminNavIconName = "home" | "overview" | "projects" | "users" | "organizations" | "audit" | "settings";

function AdminNavIcon({ name }: { name: AdminNavIconName }) {
  const paths: Record<AdminNavIconName, ReactNode> = {
    home: <><path d="m10 6-6 6 6 6" /><path d="M5 12h15" /></>,
    overview: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    projects: <><path d="M4 5h6l2 3h8v11H4V5Z" /><path d="M4 9h16M8 13h8m-8 3h5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6m0-5c3.4 0 5.3 1.7 5.8 5" /></>,
    organizations: <><path d="M4 20V6l8-3 8 3v14" /><path d="M8 9h1m6 0h1M8 13h1m6 0h1M8 17h1m6 0h1M10 20v-4h4v4" /></>,
    audit: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2M8 3.8 5.5 2.5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7l-2 .7v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7l2-.7Z" transform="translate(1.5 0) scale(.88)" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</g>
    </svg>
  );
}

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function adminAssetUrl(projectId: string, url: string) {
  const fileId = url.split("/").at(-1);
  return fileId
    ? `/api/admin/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
    : url;
}

export function resolveProjectSelection(
  requestedId: string | undefined,
  itemIds: readonly string[],
  hasLoaded: boolean,
): string | undefined {
  if (!hasLoaded) return requestedId;
  if (requestedId) return requestedId;
  if (!itemIds.length) return undefined;
  return itemIds[0];
}

export function localizedAdminLocation(
  pathname: string,
  search: string,
  hash: string,
  currentLocale: SupportedLocale,
  nextLocale: SupportedLocale,
): string {
  return `${pathname.replace(`/${currentLocale}`, `/${nextLocale}`)}${search}${hash}`;
}

export function customerPortalUrl(
  locale: SupportedLocale,
  configuredBase = import.meta.env.VITE_CUSTOMER_APP_URL,
): string {
  const base =
    configuredBase?.trim() ||
    (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5173`
      : "");
  return `${base.replace(/\/$/, "")}/${locale}/tasks`;
}

function adminUserAvatarUrl(userId: string) {
  return `/api/admin/users/${encodeURIComponent(userId)}/avatar`;
}

function IdentityGate({
  requiresBootstrap,
  busy,
  error,
  onAuthenticate,
}: {
  requiresBootstrap: boolean;
  busy: boolean;
  error?: string;
  onAuthenticate: (value: {
    displayName: string;
    email: string;
    password: string;
    rememberMe: boolean;
  }) => void;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (
      requiresBootstrap &&
      password !== String(data.get("confirmPassword") ?? "")
    )
      return;
    onAuthenticate({
      displayName: String(data.get("displayName") ?? ""),
      email: String(data.get("email") ?? ""),
      password,
      rememberMe: data.get("rememberMe") === "on",
    });
  };
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-mark">LW</div>
        <h1>
          {t(
            requiresBootstrap
              ? "admin.auth.bootstrapTitle"
              : "admin.auth.title",
          )}
        </h1>
        <p>
          {t(
            requiresBootstrap ? "admin.auth.bootstrapBody" : "admin.auth.body",
          )}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          {requiresBootstrap && (
            <label>
              <span>{t("admin.users.name")}</span>
              <input
                name="displayName"
                autoComplete="name"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
          )}
          <label>
            <span>{t("admin.users.email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
            />
          </label>
          <label>
            <span>{t("admin.users.password")}</span>
            <input
              name="password"
              type="password"
              autoComplete={
                requiresBootstrap ? "new-password" : "current-password"
              }
              minLength={requiresBootstrap ? 12 : undefined}
              maxLength={128}
              required
            />
          </label>
          {requiresBootstrap ? (
            <label>
              <span>{t("admin.users.confirmPassword")}</span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
          ) : (
            <label className="check-row">
              <input name="rememberMe" type="checkbox" />
              <span>{t("admin.auth.remember")}</span>
            </label>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {t(
              busy
                ? "common.loading"
                : requiresBootstrap
                  ? "admin.auth.createOwner"
                  : "admin.auth.signIn",
            )}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminShell({
  user,
  locale,
  children,
}: {
  user: CurrentUser;
  locale: SupportedLocale;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const avatarTriggerRef = useRef<HTMLButtonElement>(null);
  const accountId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<string>();
  const avatarUpdate = useMutation({
    mutationFn: (action: { file?: File; remove?: boolean }) => action.remove ? authService.removeAvatar() : authService.uploadAvatar(action.file!),
    onMutate: () => setAvatarFeedback(undefined),
    onSuccess: (updated, action) => {
      queryClient.setQueryData(["admin-me"], updated);
      setAvatarFeedback(t(action.remove ? "admin.account.avatarRemoved" : "admin.account.avatarUpdated"));
      setAvatarEditorOpen(false);
    },
  });
  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node))
        setAccountOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [accountOpen]);
  useEffect(() => {
    if (!avatarFeedback) return;
    const timer = window.setTimeout(() => setAvatarFeedback(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [avatarFeedback]);
  const logout = async () => {
    setLogoutPending(true);
    setLogoutFailed(false);
    try {
      await authService.logout();
      queryClient.clear();
      window.location.reload();
    } catch {
      setLogoutFailed(true);
      setLogoutPending(false);
    }
  };
  const changeLocale = (next: string) => {
    if (isSupportedLocale(next))
      navigate(
        localizedAdminLocation(
          window.location.pathname,
          window.location.search,
          window.location.hash,
          locale,
          next,
        ),
      );
  };
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#main-content">
        {t("nav.skipToContent")}
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span>LW</span>
          <div>
            <strong translate="no">{t("app.name")}</strong>
            <small>{t("admin.productName")}</small>
          </div>
        </div>
        <nav className="admin-navigation" aria-label={t("admin.navGroups.label")}>
          <a className="nav-home" href={customerPortalUrl(locale)}>
            <span className="nav-icon" aria-hidden="true">
              <AdminNavIcon name="home" />
            </span>
            <span className="nav-label">{t("admin.nav.home")}</span>
          </a>
          <section className="nav-group" aria-labelledby="nav-group-operations">
            <h2 id="nav-group-operations">{t("admin.navGroups.operations")}</h2>
            <div className="nav-grid">
              <NavLink to={localizedPath(locale, "/overview")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="overview" /></span>
                <span className="nav-label">{t("admin.nav.overview")}</span>
              </NavLink>
              <NavLink to={localizedPath(locale, "/projects")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="projects" /></span>
                <span className="nav-label">{t("admin.nav.projects")}</span>
              </NavLink>
            </div>
          </section>
          <section className="nav-group" aria-labelledby="nav-group-directory">
            <h2 id="nav-group-directory">{t("admin.navGroups.directory")}</h2>
            <div className="nav-grid">
              <NavLink to={localizedPath(locale, "/users")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="users" /></span>
                <span className="nav-label">{t("admin.nav.users")}</span>
              </NavLink>
              <NavLink to={localizedPath(locale, "/organizations")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="organizations" /></span>
                <span className="nav-label">{t("admin.nav.organizations")}</span>
              </NavLink>
            </div>
          </section>
          <section className="nav-group" aria-labelledby="nav-group-governance">
            <h2 id="nav-group-governance">{t("admin.navGroups.governance")}</h2>
            <div className="nav-grid">
              <NavLink to={localizedPath(locale, "/audit")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="audit" /></span>
                <span className="nav-label">{t("admin.nav.audit")}</span>
              </NavLink>
              <NavLink to={localizedPath(locale, "/settings")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="settings" /></span>
                <span className="nav-label">{t("admin.nav.settings")}</span>
              </NavLink>
            </div>
          </section>
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>{t("admin.internalWorkspace")}</span>
          <div className="topbar-actions">
            <label>
              <span className="sr-only">{t("nav.language")}</span>
              <select
                value={locale}
                onChange={(event) => changeLocale(event.target.value)}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <div className="admin-account" ref={accountRef}>
              <button ref={avatarTriggerRef} className="admin-avatar-trigger" type="button" aria-label={t("admin.account.openAvatarEditor")} onClick={() => { setAccountOpen(false); setAvatarEditorOpen(true); }}>
                <img className="account-avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" />
              </button>
              <button
                ref={accountTriggerRef}
                className="admin-account-trigger"
                type="button"
                aria-expanded={accountOpen}
                aria-controls={accountId}
                aria-label={t("nav.accountMenu", { name: user.displayName })}
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span>{user.displayName}</span>
                <span className="account-chevron" aria-hidden="true">
                  ⌄
                </span>
              </button>
              {accountOpen && (
                <div
                  id={accountId}
                  className="admin-account-popover"
                  role="region"
                  aria-label={t("nav.account")}
                >
                  <div className="admin-account-identity">
                    <button type="button" className="admin-account-avatar-preview" aria-label={t("admin.account.openAvatarEditor")} onClick={() => { setAccountOpen(false); setAvatarEditorOpen(true); }}>
                      <img className="account-avatar account-avatar-large" src={user.avatarUrl || "/api/me/avatar"} alt="" width="46" height="46" />
                    </button>
                    <div><strong>{user.displayName}</strong>{user.email && <span>{user.email}</span>}{user.organization?.name && <span>{user.organization.name}</span>}<small>{user.roles.map((role) => t(`admin.roles.${role}`)).join(" · ")}</small></div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      setChangePasswordOpen(true);
                    }}
                  >
                    {t("admin.account.changePassword")}
                  </button>
                  <button
                    type="button"
                    disabled={logoutPending}
                    onClick={() => void logout()}
                  >
                    {t(logoutPending ? "nav.loggingOut" : "nav.logout")}
                  </button>
                  {logoutFailed && (
                    <p className="admin-account-error" role="alert">
                      {t("nav.logoutFailed")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <div id="main-content" className="workspace-main" tabIndex={-1}>
          {children}
        </div>
      </div>
      {avatarFeedback && <p className="avatar-update-toast" role="status" aria-live="polite">{avatarFeedback}</p>}
      <ToastHost />
      {changePasswordOpen && (
        <ChangeOwnPasswordDialog onClose={() => setChangePasswordOpen(false)} />
      )}
      {avatarEditorOpen && <Suspense fallback={null}><AvatarEditor
        avatarUrl={user.avatarUrl || "/api/me/avatar"}
        displayName={user.displayName}
        hasCustomAvatar={Boolean(user.hasCustomAvatar)}
        busy={avatarUpdate.isPending}
        error={avatarUpdate.isError ? t("admin.account.avatarFailed") : undefined}
        onClose={() => { if (!avatarUpdate.isPending) { setAvatarEditorOpen(false); avatarUpdate.reset(); } }}
        onSave={(file) => avatarUpdate.mutate({ file })}
        onRemove={() => { if (window.confirm(t("admin.account.removeAvatarConfirm"))) avatarUpdate.mutate({ remove: true }); }}
        returnFocus={avatarTriggerRef.current}
        labels={{
          title: t("admin.account.avatarEditorTitle"), close: t("common.close"), choose: t("admin.account.chooseAvatar"), chooseAnother: t("admin.account.chooseAnotherAvatar"),
          instruction: t("admin.account.avatarCropInstruction"), zoom: t("admin.account.avatarZoom"), cancel: t("common.cancel"), save: t("admin.account.saveAvatar"),
          saving: t("admin.account.avatarUploading"), remove: t("admin.account.removeAvatar"), invalidImage: t("admin.account.avatarSourceInvalid"),
        }}
      /></Suspense>}
    </div>
  );
}

function ProjectsPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [workflow, setWorkflow] = useState<WorkflowStatus | "">(
    () => (searchParams.get("workflow") ?? "") as WorkflowStatus | "",
  );
  const [priority, setPriority] = useState<ProjectPriority | "">(
    () => (searchParams.get("priority") ?? "") as ProjectPriority | "",
  );
  const [page, setPage] = useState(() =>
    Math.max(1, Number(searchParams.get("page")) || 1),
  );
  const requestedProjectId = searchParams.get("project") ?? undefined;
  const projects = useQuery({
    queryKey: ["admin-projects", workflow, priority, search, page],
    queryFn: () =>
      adminService.listProjects({
        workflowStatus: workflow || undefined,
        priority: priority || undefined,
        search: search || undefined,
        page,
        pageSize: 20,
      }),
  });
  const selectedId = resolveProjectSelection(
    requestedProjectId,
    projects.data?.items.map((item) => item.id) ?? [],
    Boolean(projects.data),
  );
  const detail = useQuery({
    queryKey: ["admin-project", selectedId],
    queryFn: () => adminService.getProject(selectedId!),
    enabled: Boolean(selectedId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const staff = useQuery({
    queryKey: ["admin-assignees"],
    queryFn: adminService.listAssignees,
  });
  const options = useQuery({
    queryKey: ["form-options", locale],
    queryFn: () => optionService.getFormOptions(locale),
  });
  const voices = useQuery({
    queryKey: ["admin-voices"],
    queryFn: adminService.listVoiceReferences,
  });
  const workflowOptions = options.data?.workflowStatuses ?? [];
  const priorityOptions = options.data?.projectPriorities ?? [];
  const workflowLabels = useMemo(
    () => new Map(workflowOptions.map((item) => [item.id, item.label])),
    [workflowOptions],
  );
  const updateUrl = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setSearchParams(next, { replace: true });
  };
  const assignees = useMemo(() => staff.data ?? [], [staff.data]);
  const pages = Math.max(1, Math.ceil((projects.data?.total ?? 0) / 20));
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setPage(1);
    setSearch(value);
    updateUrl({ q: value, page: undefined });
  };
  const updateWorkflow = useMutation({
    mutationFn: (value: {
      workflowStatus: WorkflowStatus;
      priority: ProjectPriority;
      assigneeUserId?: string;
    }) =>
      adminService.updateWorkflow(
        selectedId!,
        value.workflowStatus,
        value.priority,
        detail.data!.workflowUpdatedAt,
        value.assigneeUserId,
      ),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.workflowSaved"));
      await queryClient.invalidateQueries({ queryKey: ["admin-project"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-projects"] });
    },
  });
  const addNote = useMutation({
    mutationFn: (body: string) => adminService.addNote(selectedId!, body),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.noteAdded"));
      await queryClient.invalidateQueries({ queryKey: ["admin-project"] });
    },
  });
  return (
    <main className="content projects-content">
      <section className="page-toolbar">
        <form onSubmit={submitSearch} role="search">
          <input
            name="q"
            autoComplete="off"
            aria-label={t("admin.projects.search")}
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("admin.projects.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <select
          aria-label={t("admin.projects.statusFilter")}
          value={workflow}
          onChange={(event) => {
            setPage(1);
            setWorkflow(event.target.value as WorkflowStatus | "");
            updateUrl({ workflow: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.projects.allStatuses")}</option>
          {workflowOptions.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t("admin.projects.priorityFilter")}
          value={priority}
          onChange={(event) => {
            setPage(1);
            setPriority(event.target.value as ProjectPriority | "");
            updateUrl({ priority: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.projects.allPriorities")}</option>
          {priorityOptions.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="result-count">
          {t("admin.projects.count", { count: projects.data?.total ?? 0 })}
        </span>
      </section>
      <div className="master-detail">
        <section className="project-pane" aria-label={t("admin.projects.list")}>
          {projects.isError && (
            <div className="message error">
              {localizedApiError(projects.error, t)}
            </div>
          )}
          <div className="project-rows">
            {projects.data?.items.map((item) => (
              <ProjectRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                locale={locale}
                statusLabel={
                  workflowLabels.get(item.workflowStatus) ?? item.workflowStatus
                }
                onSelect={() => {
                  updateUrl({ project: item.id });
                }}
              />
            ))}
          </div>
          {!projects.isPending && !projects.data?.items.length && (
            <div className="empty">{t("admin.projects.empty")}</div>
          )}
          <nav className="pager">
            <button
              type="button"
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
              type="button"
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
        <ProjectDetail
          detail={detail.data}
          switching={detail.isPlaceholderData && detail.isFetching}
          loading={
            (detail.isPending && Boolean(selectedId)) || options.isPending || voices.isPending
          }
          locale={locale}
          assignees={assignees}
          workflowOptions={workflowOptions}
          priorityOptions={priorityOptions}
          formOptions={options.data}
          voiceReferences={voices.data ?? []}
          busy={
            detail.isFetching ||
            updateWorkflow.isPending ||
            addNote.isPending ||
            options.isPending ||
            options.isError ||
            voices.isError ||
            !workflowOptions.length ||
            !priorityOptions.length
          }
          error={
            detail.error ??
            updateWorkflow.error ??
            addNote.error ??
            options.error ??
            voices.error
          }
          onWorkflow={(value) => updateWorkflow.mutate(value)}
          onNote={async (body) => {
            await addNote.mutateAsync(body);
          }}
        />
      </div>
    </main>
  );
}

function ProjectRow({
  item,
  selected,
  locale,
  statusLabel,
  onSelect,
}: {
  item: AdminProjectSummary;
  selected: boolean;
  locale: SupportedLocale;
  statusLabel: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "project-row selected" : "project-row"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      {item.coverUrl ? (
        <img
          src={adminAssetUrl(item.id, item.coverUrl)}
          alt=""
          width="42"
          height="58"
          loading="lazy"
        />
      ) : (
        <span className="cover-placeholder" />
      )}
      <span className="row-main">
        <strong>{item.projectName || item.bookTitle || "—"}</strong>
        <small>
          {item.ownerName} · {item.bookTitle || "—"}
        </small>
        <small>
          {item.taskNumber ?? item.id.slice(0, 8)} ·{" "}
          {formatDate(item.updatedAt, locale)}
        </small>
      </span>
      <span className={`status status-${item.workflowStatus}`}>
        {statusLabel}
      </span>
    </button>
  );
}

function ProjectDetail({
  detail,
  switching,
  loading,
  locale,
  assignees,
  workflowOptions,
  priorityOptions,
  formOptions,
  voiceReferences,
  busy,
  error,
  onWorkflow,
  onNote,
}: {
  detail?: AdminProjectDetail;
  switching: boolean;
  loading: boolean;
  locale: SupportedLocale;
  assignees: AdminUser[];
  workflowOptions: ConfigOption[];
  priorityOptions: ConfigOption[];
  formOptions?: FormOptions;
  voiceReferences: AdminVoiceReference[];
  busy: boolean;
  error: unknown;
  onWorkflow: (value: {
    workflowStatus: WorkflowStatus;
    priority: ProjectPriority;
    assigneeUserId?: string;
  }) => void;
  onNote: (body: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (loading)
    return <aside className="detail-pane empty">{t("common.loading")}</aside>;
  if (!detail)
    return (
      <aside className="detail-pane empty">{t("admin.projects.select")}</aside>
    );
  const task = detail.project;
  const assets = [
    ...task.book.sourceAssets,
    ...(task.creative.styleReferenceImages ?? []),
    ...task.creative.characters.flatMap((character) => character.referenceImages ?? []),
    ...task.voiceAndReferences.assets,
  ];
  const assetCategoryLabel = (categoryId: string) =>
    [...(formOptions?.sourceCategories ?? []), ...(formOptions?.referenceCategories ?? [])]
      .find((category) => category.id === categoryId)?.label ?? categoryId;
  const saveWorkflow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    onWorkflow({
      workflowStatus: String(data.get("workflowStatus")) as WorkflowStatus,
      priority: String(data.get("priority")) as ProjectPriority,
      assigneeUserId: String(data.get("assigneeUserId") || "") || undefined,
    });
  };
  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (body) void onNote(body).then(() => form.reset());
  };
  return (
    <aside
      className={switching ? "detail-pane switching" : "detail-pane"}
      aria-busy={switching}
    >
      <div className="detail-title">
        <div>
          <span className="eyebrow">
            {task.taskNumber ?? task.id.slice(0, 8)}
          </span>
          <h2>{task.project.projectName || task.book.title || "—"}</h2>
          <p>
            {detail.ownerName} · {detail.ownerEmail}
          </p>
        </div>
        <span className={`status status-${detail.workflowStatus}`}>
          {workflowOptions.find((item) => item.id === detail.workflowStatus)
            ?.label ?? detail.workflowStatus}
        </span>
      </div>
      <form
        className="workflow-form"
        onSubmit={saveWorkflow}
        key={`${task.id}-${detail.workflowStatus}-${detail.priority}-${detail.assigneeUserId}`}
      >
        <label>
          <span>{t("admin.projects.workflow")}</span>
          <select name="workflowStatus" defaultValue={detail.workflowStatus}>
            {workflowOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("admin.projects.priority")}</span>
          <select name="priority" defaultValue={detail.priority}>
            {priorityOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("admin.projects.assignee")}</span>
          <select
            name="assigneeUserId"
            defaultValue={detail.assigneeUserId ?? ""}
          >
            <option value="">{t("admin.projects.unassigned")}</option>
            {assignees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy}>
          {t("common.save")}
        </button>
      </form>
      {Boolean(error) && (
        <div className="message error">{localizedApiError(error, t)}</div>
      )}
      <FinalDeliveryPanel
        projectId={task.id}
        projectStatus={task.status}
        locale={locale}
      />
      <ProjectSubmissionDetails
        task={task}
        locale={locale}
        options={formOptions}
        voiceReferences={voiceReferences}
      />
      <section className="detail-section">
        <h3>{t("admin.projects.files", { count: assets.length })}</h3>
        {assets.length ? (
          <ul className="file-list">
            {assets.map((asset) => (
              <li key={asset.id}>
                <a
                  href={adminAssetUrl(task.id, asset.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {asset.fileName}
                </a>
                <small>{assetCategoryLabel(asset.categoryId)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("admin.projects.noFiles")}</p>
        )}
      </section>
      <section className="detail-section notes">
        <h3>{t("admin.projects.notes")}</h3>
        <form onSubmit={saveNote}>
          <textarea
            name="body"
            rows={2}
            maxLength={4000}
            required
            placeholder={t("admin.projects.notePlaceholder")}
          />
          <button disabled={busy}>{t("admin.projects.addNote")}</button>
        </form>
        {detail.notes.length ? (
          <ol>
            {detail.notes.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <small>
                  {note.authorName} · {formatDate(note.createdAt, locale)}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t("admin.projects.noNotes")}</p>
        )}
      </section>
    </aside>
  );
}

type SubmissionFact = { label: string; value?: ReactNode; wide?: boolean };

function FactGrid({ facts }: { facts: SubmissionFact[] }) {
  return (
    <dl className="fact-grid">
      {facts.map((fact) => (
        <div className={fact.wide ? "wide" : undefined} key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReferenceLinks({ urls }: { urls: string[] }) {
  const safeUrls = urls.filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });
  return safeUrls.length ? (
    <ul className="reference-links">
      {safeUrls.map((url, index) => (
        <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>
      ))}
    </ul>
  ) : <span>—</span>;
}

function ReferenceFiles({ projectId, assets, legacyUrls }: { projectId: string; assets: ReferenceAsset[]; legacyUrls: string[] }) {
  const safeLegacyUrls = legacyUrls.filter((url) => {
    try { return ["http:", "https:"].includes(new URL(url).protocol); }
    catch { return false; }
  });
  if (!assets.length && !safeLegacyUrls.length) return <span>—</span>;
  return <ul className="reference-links">
    {assets.map((asset) => <li key={asset.id}><a href={adminAssetUrl(projectId, asset.url)} target="_blank" rel="noreferrer">{asset.fileName}</a></li>)}
    {safeLegacyUrls.map((url, index) => <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}
  </ul>;
}

function ProjectSubmissionDetails({ task, locale, options, voiceReferences }: {
  task: AdminProjectDetail["project"];
  locale: SupportedLocale;
  options?: FormOptions;
  voiceReferences: AdminVoiceReference[];
}) {
  const { t } = useTranslation();
  const optionMaps = useMemo(() => {
    const groups: Record<string, ConfigOption[] | undefined> = {
      brands: options?.brands,
      videoGoals: options?.videoGoals,
      audiences: options?.audiences,
      genres: options?.genres,
      contentLanguages: options?.contentLanguages,
      videoDurations: options?.videoDurations,
      publishingPlatforms: options?.publishingPlatforms,
      roleTypes: options?.roleTypes,
      ageRanges: options?.ageRanges,
      genders: options?.genders,
      visualStyles: options?.visualStyles,
      moodTags: options?.moodTags,
      imageStyleTags: [...(options?.imageStyleTags ?? []), ...(options?.legacyImageStyleTags ?? [])],
      paceTags: options?.paceTags,
      narrationTones: options?.narrationTones,
      speechRates: options?.speechRates,
      voiceGenders: options?.voiceGenders,
      voiceAges: options?.voiceAges,
      accents: options?.accents,
      voiceEmotions: options?.voiceEmotions,
    };
    return new Map(Object.entries(groups).map(([group, items]) => [group, new Map((items ?? []).map((item) => [item.id, item.label]))]));
  }, [options]);
  const voiceNames = useMemo(
    () => new Map(voiceReferences.map((voice) => [voice.id, locale === "en-US" ? voice.nameEnUs : voice.nameZhCn])),
    [locale, voiceReferences],
  );
  const listFormat = useMemo(() => new Intl.ListFormat(locale, { style: "short", type: "conjunction" }), [locale]);
  const label = (group: string, id?: string) => id ? optionMaps.get(group)?.get(id) ?? id : undefined;
  const labels = (group: string, ids: string[]) => ids.length ? listFormat.format(ids.map((id) => label(group, id) ?? id)) : undefined;
  const project = task.project;
  const book = task.book;
  const creative = task.creative;
  const voice = task.voiceAndReferences.voiceover;
  const narrationEnabled = getNarrationEnabled(voice);
  const direction = task.voiceAndReferences.creativeDirection;
  const selectedVoices = voice.selectedVoiceIds.map((id) => voiceNames.get(id) ?? id);
  const characterPanelId = useId();
  const [characterSelection, setCharacterSelection] = useState<{
    projectId: string;
    characterId: string;
  }>();
  const requestedCharacterId =
    characterSelection?.projectId === task.id
      ? characterSelection.characterId
      : undefined;
  const selectedCharacter =
    creative.characters.find(
      (character) => character.id === requestedCharacterId,
    ) ?? creative.characters[0];
  const selectedCharacterIndex = selectedCharacter
    ? creative.characters.findIndex(
        (character) => character.id === selectedCharacter.id,
      )
    : -1;

  return (
    <div className="submission-sections">
      <section className="detail-section">
        <h3>{t("admin.projects.projectInfo")}</h3>
        <FactGrid facts={[
          { label: t("wizard.fields.clientName"), value: project.clientName },
          { label: t("wizard.fields.contactName"), value: project.contactName },
          { label: t("wizard.fields.email"), value: project.email },
          { label: t("wizard.fields.phone"), value: project.phone },
          { label: t("wizard.fields.brand"), value: label("brands", project.brandId) },
          { label: t("wizard.fields.projectName"), value: project.projectName },
          { label: t("wizard.fields.videoGoal"), value: label("videoGoals", project.videoGoalId) },
          { label: t("wizard.fields.deadline"), value: project.deadline },
          { label: t("wizard.fields.audiences"), value: labels("audiences", project.audienceIds), wide: true },
        ]} />
      </section>
      <section className="detail-section">
        <h3>{t("admin.projects.bookInfo")}</h3>
        <FactGrid facts={[
          { label: t("wizard.fields.bookTitle"), value: book.title },
          { label: t("wizard.fields.subtitle"), value: book.subtitle },
          { label: t("wizard.fields.authorName"), value: book.authorName },
          { label: t("wizard.fields.genre"), value: label("genres", book.genreId) },
          { label: t("wizard.fields.contentLanguage"), value: label("contentLanguages", book.contentLanguageId) },
          { label: t("wizard.fields.duration"), value: book.customVideoDuration || label("videoDurations", book.videoDurationId) },
          { label: t("wizard.fields.platforms"), value: labels("publishingPlatforms", book.publishingPlatformIds), wide: true },
          { label: t("wizard.fields.sellingPoint"), value: book.sellingPoint, wide: true },
          { label: t("wizard.fields.synopsis"), value: book.synopsis, wide: true },
        ]} />
      </section>
      <section className="detail-section">
        <h3>{t("admin.projects.characters", { count: creative.characters.length })}</h3>
        {selectedCharacter ? (
          <>
            <div
              className="character-tabs"
              role="tablist"
              aria-label={t("admin.projects.characters", {
                count: creative.characters.length,
              })}
            >
              {creative.characters.map((character, index) => {
                const selected = character.id === selectedCharacter.id;
                return (
                  <button
                    id={`${characterPanelId}-tab-${index}`}
                    key={character.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={characterPanelId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() =>
                      setCharacterSelection({
                        projectId: task.id,
                        characterId: character.id,
                      })
                    }
                    onKeyDown={(event) => {
                      let nextIndex: number | undefined;
                      if (event.key === "ArrowRight") {
                        nextIndex = (index + 1) % creative.characters.length;
                      } else if (event.key === "ArrowLeft") {
                        nextIndex =
                          (index - 1 + creative.characters.length) %
                          creative.characters.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = creative.characters.length - 1;
                      }

                      if (nextIndex === undefined) return;
                      event.preventDefault();
                      const nextCharacter = creative.characters[nextIndex];
                      setCharacterSelection({
                        projectId: task.id,
                        characterId: nextCharacter.id,
                      });
                      requestAnimationFrame(() => {
                        document
                          .getElementById(
                            `${characterPanelId}-tab-${nextIndex}`,
                          )
                          ?.focus();
                      });
                    }}
                  >
                    {character.name ||
                      t("admin.projects.characterNumber", {
                        number: index + 1,
                      })}
                  </button>
                );
              })}
            </div>
            <div className="character-submissions">
              <article
                id={characterPanelId}
                role="tabpanel"
                aria-labelledby={`${characterPanelId}-tab-${selectedCharacterIndex}`}
              >
                <h4>
                  {selectedCharacter.name ||
                    t("admin.projects.characterNumber", {
                      number: selectedCharacterIndex + 1,
                    })}
                </h4>
                {selectedCharacter.presetId && <figure><img src={new URL(`/character-presets/${selectedCharacter.presetId}.png`, new URL(customerPortalUrl(locale), window.location.origin)).href} alt={t("bookIntake.presetImage", { name: selectedCharacter.name })} width="120" height="120" loading="lazy" /><figcaption>{t("bookIntake.presetHint")}</figcaption></figure>}
                <FactGrid facts={[
                  { label: t("creative.fields.roleType"), value: label("roleTypes", selectedCharacter.roleTypeId) },
                  { label: t("creative.fields.storyRole"), value: selectedCharacter.storyRole },
                  { label: t("creative.fields.ageRange"), value: label("ageRanges", selectedCharacter.ageRangeId) },
                  { label: t("creative.fields.gender"), value: label("genders", selectedCharacter.genderId) },
                  { label: t("creative.fields.personality"), value: selectedCharacter.personality, wide: true },
                  { label: t("creative.fields.appearance"), value: selectedCharacter.appearance, wide: true },
                  { label: t("creative.fields.clothing"), value: selectedCharacter.clothing },
                  { label: t("creative.fields.emotion"), value: selectedCharacter.emotion },
                  { label: t("creative.fields.voiceHint"), value: selectedCharacter.voiceHint, wide: true },
                  { label: t("admin.projects.referenceImages"), value: <ReferenceFiles projectId={task.id} assets={selectedCharacter.referenceImages ?? []} legacyUrls={selectedCharacter.referenceImageUrls} />, wide: true },
                ]} />
              </article>
            </div>
          </>
        ) : (
          <p className="muted">{t("admin.projects.noCharacters")}</p>
        )}
      </section>
      <section className="detail-section">
        <h3>{t("admin.projects.visualInfo")}</h3>
        <FactGrid facts={[
          { label: t("creative.fields.visualStyle"), value: label("visualStyles", creative.visualStyleId) },
          { label: t("creative.fields.moodTags"), value: labels("moodTags", creative.moodTagIds) },
          { label: t("creative.fields.imageTags"), value: labels("imageStyleTags", creative.imageStyleTagIds) },
          { label: t("creative.fields.paceTags"), value: labels("paceTags", creative.paceTagIds) },
          { label: t("admin.projects.styleReferences"), value: <ReferenceFiles projectId={task.id} assets={creative.styleReferenceImages ?? []} legacyUrls={creative.styleReferenceImageUrls} />, wide: true },
        ]} />
      </section>
      <section className="detail-section">
        <h3>{t("admin.projects.voiceInfo")}</h3>
        <FactGrid facts={[
          { label: t("voice.narration.question"), value: t(narrationEnabled === true ? "voice.narration.required" : narrationEnabled === false ? "voice.narration.notRequired" : "voice.narration.unselected"), wide: true },
          ...(narrationEnabled === true ? [
          { label: t("voice.fields.contentLanguage"), value: label("contentLanguages", voice.contentLanguageId) },
          { label: t("voice.fields.narrationTone"), value: label("narrationTones", voice.narrationToneId) },
          { label: t("voice.fields.speechRate"), value: label("speechRates", voice.speechRateId) },
          { label: t("voice.fields.voiceGender"), value: label("voiceGenders", voice.voiceGenderId) },
          { label: t("voice.fields.voiceAge"), value: label("voiceAges", voice.voiceAgeId) },
          { label: t("voice.fields.accent"), value: label("accents", voice.accentId) },
          { label: t("voice.fields.emotionStyle"), value: label("voiceEmotions", voice.emotionStyleId) },
          { label: t("admin.projects.preferredVoice"), value: voice.preferredVoiceId ? voiceNames.get(voice.preferredVoiceId) ?? voice.preferredVoiceId : undefined },
          { label: t("admin.projects.selectedVoices"), value: selectedVoices.length ? listFormat.format(selectedVoices) : undefined, wide: true },
          { label: t("voice.fields.customVoice"), value: voice.customVoiceDescription, wide: true },
          { label: t("voice.fields.pronunciationNotes"), value: voice.pronunciationNotes, wide: true },
          ] : []),
        ]} />
      </section>
      <section className="detail-section">
        <h3>{t("admin.projects.creativeDirection")}</h3>
        <FactGrid facts={[
          { label: t("voice.fields.coreMessage"), value: direction.coreMessage, wide: true },
          { label: t("voice.fields.requiredScenes"), value: direction.requiredScenes, wide: true },
          { label: t("voice.fields.authorPreferences"), value: direction.authorPreferences, wide: true },
          { label: t("voice.fields.closingMessage"), value: direction.closingMessage, wide: true },
          { label: t("voice.fields.musicMood"), value: direction.musicMood },
          { label: t("voice.fields.avoidContent"), value: direction.avoidContent },
          { label: t("voice.fields.competitorLinks"), value: <ReferenceLinks urls={task.voiceAndReferences.competitorUrls} />, wide: true },
        ]} />
      </section>
    </div>
  );
}

function UsersPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [role, setRole] = useState(searchParams.get("role") ?? "");
  const [page, setPage] = useState(() =>
    Math.max(1, Number(searchParams.get("page")) || 1),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser>();
  const [resetUser, setResetUser] = useState<AdminUser>();
  const users = useQuery({
    queryKey: ["admin-users", search, role, page],
    queryFn: () =>
      adminService.listUsers({
        search: search || undefined,
        role: role || undefined,
        page,
        pageSize: 20,
      }),
  });
  const organizations = useQuery({
    queryKey: ["admin-organizations", "user-selector"],
    queryFn: () => loadAllOrganizations(),
  });
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / 20));
  const create = useMutation({
    mutationFn: adminService.createUser,
    onSuccess: async () => {
      setShowCreate(false);
      showAdminToast(t("admin.feedback.userCreated"));
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      displayName,
      phone,
      role,
      active,
      organizationId,
    }: {
      id: string;
      displayName: string;
      phone?: string;
      role: "owner" | "customer" | "admin";
      active: boolean;
      organizationId?: string;
    }) => adminService.updateUser(id, { displayName, phone, role, active, organizationId }),
    onSuccess: async () => {
      setEditUser(undefined);
      showAdminToast(t("admin.feedback.userUpdated"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-me"] }),
      ]);
    },
  });
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setPage(1);
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    value ? next.set("q", value) : next.delete("q");
    next.delete("page");
    setSearchParams(next, { replace: true });
  };
  const setListState = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setSearchParams(next, { replace: true });
  };
  return (
    <main className="content users-content">
      <section className="page-toolbar">
        <form onSubmit={submitSearch} role="search">
          <input
            name="q"
            autoComplete="off"
            aria-label={t("admin.users.search")}
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("admin.users.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <select
          aria-label={t("admin.users.roleFilter")}
          value={role}
          onChange={(event) => {
            setPage(1);
            setRole(event.target.value);
            setListState({ role: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.users.allRoles")}</option>
          <option value="customer">{t("admin.roles.customer")}</option>
          <option value="admin">{t("admin.roles.admin")}</option>
          <option value="owner">{t("admin.roles.owner")}</option>
        </select>
        <span className="result-count">
          {t("admin.users.count", { count: users.data?.total ?? 0 })}
        </span>
        <button
          type="button"
          className="primary push-right"
          onClick={() => setShowCreate(true)}
        >
          {t("admin.users.create")}
        </button>
      </section>
      {Boolean(users.error || organizations.error) && (
        <div className="message error" role="alert">
          {localizedApiError(users.error ?? organizations.error, t)}
        </div>
      )}
      <section className="table-card">
        <div className="management-table-scroll" aria-busy={users.isFetching}>
        <table>
          <thead>
            <tr>
              <th>{t("admin.users.account")}</th>
              <th>{t("admin.users.role")}</th>
              <th>{t("admin.users.organization")}</th>
              <th>{t("admin.users.status")}</th>
              <th>{t("admin.users.created")}</th>
              <th>{t("admin.users.action")}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((user) => (
              <tr key={user.id}>
                <td data-label={t("admin.users.account")}>
                  <div className="user-cell">
                    <img
                      src={adminUserAvatarUrl(user.id)}
                      alt=""
                      width="32"
                      height="32"
                      loading="lazy"
                    />
                    <div>
                      <strong>{user.displayName}</strong>
                      <small>{user.email}{user.phone ? ` · ${user.phone}` : ""}</small>
                    </div>
                  </div>
                </td>
                <td data-label={t("admin.users.role")}>{t(`admin.roles.${user.role}`)}</td>
                <td data-label={t("admin.users.organization")}>{user.organization?.name ?? t("admin.users.noOrganization")}</td>
                <td data-label={t("admin.users.status")}>
                  <span
                    className={
                      user.active ? "status active" : "status inactive"
                    }
                  >
                    {t(
                      user.active
                        ? "admin.users.active"
                        : "admin.users.inactive",
                    )}
                  </span>
                </td>
                <td data-label={t("admin.users.created")}>{formatDate(user.createdAt, locale)}</td>
                <td data-label={t("admin.users.action")}>
                  <div className="row-actions">
                    <button type="button" onClick={() => setEditUser(user)}>{t("admin.users.edit")}</button>
                    {user.role === "owner" ? (
                      <span className="muted">{t("admin.users.protected")}</span>
                    ) : (
                      <>
                      <button type="button" onClick={() => setResetUser(user)}>
                        {t("admin.users.resetPassword")}
                      </button>
                      <button
                        type="button"
                        disabled={update.isPending}
                        onClick={() => {
                          if (
                            user.active &&
                            !window.confirm(
                              t("admin.users.deactivateConfirm", {
                                name: user.displayName,
                              }),
                            )
                          )
                            return;
                          update.mutate({
                            id: user.id,
                            displayName: user.displayName,
                            phone: user.phone,
                            role: user.role,
                            active: !user.active,
                            organizationId: user.organization?.id,
                          });
                        }}
                      >
                        {t(
                          user.active
                            ? "admin.users.deactivate"
                            : "admin.users.activate",
                        )}
                      </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.isPending && !users.data?.items.length && (
          <div className="empty">{t("admin.users.empty")}</div>
        )}
        </div>
        <nav className="pager">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              setListState({ page: next > 1 ? String(next) : undefined });
            }}
          >
            {t("common.previous")}
          </button>
          <span>{t("common.pageOf", { page, pages })}</span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              setListState({ page: String(next) });
            }}
          >
            {t("common.next")}
          </button>
        </nav>
      </section>
      {showCreate && (
        <CreateUserDialog
          busy={create.isPending}
          error={create.error}
          organizations={organizations.data ?? []}
          onClose={() => setShowCreate(false)}
          onCreate={(value) => create.mutate(value)}
        />
      )}
      {editUser && (
        <EditUserDialog
          user={editUser}
          organizations={organizations.data ?? []}
          busy={update.isPending}
          error={update.error}
          onClose={() => setEditUser(undefined)}
          onSave={(value) => update.mutate(value)}
        />
      )}
      {resetUser && (
        <ResetUserPasswordDialog
          user={resetUser}
          onClose={() => setResetUser(undefined)}
        />
      )}
    </main>
  );
}

function CreateUserDialog({
  busy,
  error,
  organizations,
  onClose,
  onCreate,
}: {
  busy: boolean;
  error: unknown;
  organizations: AdminOrganization[];
  onClose: () => void;
  onCreate: (value: {
    displayName: string;
    email: string;
    phone?: string;
    password: string;
    role: "customer" | "admin";
    organizationId?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onCreate({
      displayName: String(data.get("displayName")),
      email: String(data.get("email")),
      phone: String(data.get("phone") ?? "").trim() || undefined,
      password: String(data.get("password")),
      role: String(data.get("role")) as "customer" | "admin",
      organizationId: String(data.get("organizationId") ?? "") || undefined,
    });
  };
  return (
    <ModalFrame labelledBy="create-user-title" busy={busy} onClose={requestClose}>
      <div className="modal-title">
        <h2 id="create-user-title">{t("admin.users.create")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>
          ×
        </button>
      </div>
      <form onSubmit={submit} onChange={markDirty}>
        <label>
          <span>{t("admin.users.name")}</span>
          <input
            name="displayName"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label>
          <span>{t("admin.users.email")}</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            maxLength={254}
            required
          />
        </label>
        <label>
          <span>{t("admin.users.phone")}</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} />
        </label>
        <label>
          <span>{t("admin.users.password")}</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <small>{t("admin.users.passwordHint")}</small>
        </label>
        <label>
          <span>{t("admin.users.role")}</span>
          <select name="role" defaultValue="customer">
            <option value="customer">{t("admin.roles.customer")}</option>
            <option value="admin">{t("admin.roles.admin")}</option>
          </select>
        </label>
        <label>
          <span>{t("admin.users.organization")}</span>
          <select name="organizationId" defaultValue="">
            <option value="">{t("admin.users.noOrganization")}</option>
            {organizations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <small>{t("admin.users.organizationHint")}</small>
        </label>
        {Boolean(error) && (
          <div className="message error" role="alert">
            {localizedApiError(error, t)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={requestClose}>
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={busy}>
            {t(busy ? "common.loading" : "admin.users.createAction")}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function EditUserDialog({ user, organizations, busy, error, onClose, onSave }: {
  user: AdminUser;
  organizations: AdminOrganization[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (value: { id: string; displayName: string; phone?: string; role: "owner" | "customer" | "admin"; active: boolean; organizationId?: string }) => void;
}) {
  const { t } = useTranslation();
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({
      id: user.id,
      displayName: String(data.get("displayName") ?? ""),
      phone: String(data.get("phone") ?? "").trim() || undefined,
      role: user.role === "owner" ? "owner" : String(data.get("role")) as "customer" | "admin",
      active: user.role === "owner" || data.get("active") === "on",
      organizationId: String(data.get("organizationId") ?? "") || undefined,
    });
  };
  const selectableOrganizations = organizations.filter((item) => item.active || item.id === user.organization?.id);
  return (
    <ModalFrame labelledBy="edit-user-title" busy={busy} onClose={requestClose}>
      <div className="modal-title">
        <h2 id="edit-user-title">{t("admin.users.edit")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>×</button>
      </div>
      <form onSubmit={submit} onChange={markDirty}>
        <label><span>{t("admin.users.name")}</span><input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={100} required /></label>
        <label><span>{t("admin.users.email")}</span><input value={user.email} readOnly aria-readonly="true" /></label>
        <label><span>{t("admin.users.phone")}</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} defaultValue={user.phone ?? ""} /></label>
        <label>
          <span>{t("admin.users.role")}</span>
          {user.role === "owner" ? <input value={t("admin.roles.owner")} readOnly aria-readonly="true" /> : (
            <select name="role" defaultValue={user.role}>
              <option value="customer">{t("admin.roles.customer")}</option>
              <option value="admin">{t("admin.roles.admin")}</option>
            </select>
          )}
        </label>
        <label>
          <span>{t("admin.users.organization")}</span>
          <select name="organizationId" defaultValue={user.organization?.id ?? ""}>
            <option value="">{t("admin.users.noOrganization")}</option>
            {selectableOrganizations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : ` · ${t("admin.organizations.inactive")}`}</option>)}
          </select>
          <small>{t("admin.users.organizationHint")}</small>
        </label>
        {user.role !== "owner" && <label className="check-row"><input name="active" type="checkbox" defaultChecked={user.active} /><span>{t("admin.users.accountEnabled")}</span></label>}
        {Boolean(error) && <div className="message error" role="alert">{localizedApiError(error, t)}</div>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "common.loading" : "common.save")}</button></div>
      </form>
    </ModalFrame>
  );
}

function AdminRoot() {
  const { locale: routeLocale } = useParams();
  const locale: SupportedLocale = isSupportedLocale(routeLocale)
    ? routeLocale
    : "zh-CN";
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    window.localStorage.setItem("lw.locale", locale);
    void setLocale(locale);
    document.documentElement.lang = locale;
    document.title = t("admin.documentTitle");
  }, [locale, t]);
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: authService.getCurrentUser,
    retry: false,
  });
  const authStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: authService.getStatus,
    enabled: me.isError,
    retry: false,
  });
  const authenticate = async (value: {
    displayName: string;
    email: string;
    password: string;
    rememberMe: boolean;
  }) => {
    setBusy(true);
    setError(undefined);
    try {
      if (authStatus.data?.requiresBootstrap)
        await authService.bootstrap(value);
      else await authService.login(value);
      await queryClient.invalidateQueries();
    } catch (reason) {
      setError(localizedApiError(reason, t));
    } finally {
      setBusy(false);
    }
  };
  if (me.isPending || (me.isError && authStatus.isPending))
    return <main className="center-state">{t("common.loading")}</main>;
  const signedOut = me.error instanceof ApiError && me.error.details.code === "auth.unauthorized";
  if (!me.data && (!signedOut || authStatus.isError))
    return (
      <main className="center-state" role="alert">
        <div>
          <h1>{t("common.fatalErrorTitle")}</h1>
          <p>{localizedApiError(authStatus.error ?? me.error, t)}</p>
          <button type="button" onClick={() => { void me.refetch(); void authStatus.refetch(); }}>{t("common.retry")}</button>
        </div>
      </main>
    );
  if (!me.data)
    return (
      <IdentityGate
        requiresBootstrap={authStatus.data?.requiresBootstrap === true}
        busy={busy}
        error={error}
        onAuthenticate={(value) => void authenticate(value)}
      />
    );
  if (!me.data.permissions.includes("admin.access"))
    return (
      <main className="center-state">
        <div>
          <h1>{t("admin.forbidden.title")}</h1>
          <p>{t("admin.forbidden.body")}</p>
          <button
            type="button"
            onClick={() =>
              void authService.logout().then(() => window.location.reload())
            }
          >
            {t("nav.logout")}
          </button>
        </div>
      </main>
    );
  return (
    <AdminShell user={me.data} locale={locale}>
      <Suspense fallback={<main className="center-state" role="status" aria-busy="true">{t("common.loading")}</main>}>
        <Routes>
        <Route index element={<Navigate replace to="overview" />} />
        <Route path="overview" element={<OverviewPage locale={locale} />} />
        <Route path="projects" element={<ProjectsPage locale={locale} />} />
        <Route path="users" element={<UsersPage locale={locale} />} />
        <Route path="organizations" element={<OrganizationsPage locale={locale} />} />
        <Route path="audit" element={<AuditPage locale={locale} />} />
        <Route path="settings/ai" element={<AiSettingsPage locale={locale} />} />
        <Route path="settings" element={<Navigate replace to="options" />} />
        <Route
          path="settings/options"
          element={<FormOptionConfigPage locale={locale} />}
        />
        <Route
          path="settings/files"
          element={<FileCategoryConfigPage locale={locale} />}
        />
        <Route
          path="settings/voices"
          element={<VoiceConfigPage locale={locale} />}
        />
        <Route
          path="settings/runtime"
          element={<SystemRuntimePage locale={locale} />}
        />
        <Route
          path="voices"
          element={
            <Navigate replace to={localizedPath(locale, "/settings/voices")} />
          }
        />
        <Route path="*" element={<Navigate replace to="overview" />} />
        </Routes>
      </Suspense>
    </AdminShell>
  );
}

function AdminRootRedirect() {
  const stored = window.localStorage.getItem("lw.locale") ?? undefined;
  const locale: SupportedLocale = isSupportedLocale(stored)
    ? stored
    : navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return <Navigate replace to={localizedPath(locale, "/overview")} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminRootRedirect />} />
      <Route path="/:locale/*" element={<AdminRoot />} />
      <Route path="*" element={<AdminRootRedirect />} />
    </Routes>
  );
}
