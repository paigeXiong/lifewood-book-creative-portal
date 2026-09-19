import { readNoticeDraft } from "./announcement-draft";
import { FunctionSearch } from "./FunctionSearch";
import { AccountLocaleRedirect } from "@lifewood/ui/account-locale";
import { ForgotPasswordButton } from "@lifewood/ui/email";
import { OtherLoginMethods } from "@lifewood/ui/oidc";
import { OidcSettingsPage } from "./OidcSettingsPage";
import { MailStatusPage } from "./MailStatusPage";
import { AccountSessionGuard,AccountSwitcher } from "@lifewood/ui/account-switcher";
import { NotificationBell,NotificationCenter } from "@lifewood/ui/notifications";
import { UserPresence } from "@lifewood/ui/user-presence";
import { customerPortalUrl } from "./portal-url";
export { customerPortalUrl } from "./portal-url";

import {
ApiError,
authService,
localizedApiError
} from "@lifewood/api-client";
import type {
CurrentUser,
SupportedLocale
} from "@lifewood/domain";
import { isSupportedLocale,localizedPath,setLocale } from "@lifewood/i18n";
import {
useQuery,
useMutation,
useQueryClient
} from "@tanstack/react-query";
import {
lazy,
Suspense,
useEffect,
useId,
useRef,
useState,
type FormEvent,
type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import {
Navigate,
NavLink,
Route,
Routes,
useLocation,
useParams
} from "react-router-dom";
import { ToastHost } from "./Toast";

const InvitationsPage = lazy(() => import("./InvitationsPage").then(m=>({default:m.InvitationsPage})));
const MailTemplatePage = lazy(() => import("./MailTemplatePage").then(m => ({ default: m.MailTemplatePage })));
const FeedbackPage = lazy(()=>import("./FeedbackPage").then(m=>({default:m.FeedbackPage})));
const ProjectsPage = lazy(() => import("./ProjectsPage").then(module => ({ default: module.ProjectsPage })));
const UsersPage = lazy(() => import("./UsersPage").then(module => ({ default: module.UsersPage })));
const NotificationSettingsPage = lazy(() => import("./NotificationSettingsPage").then(module => ({ default: module.NotificationSettingsPage })));
const AnnouncementsPage = lazy(() => import("./AnnouncementsPage").then(module => ({ default: module.AnnouncementsPage })));
const ReportsPage = lazy(()=>import("./ReportsPage").then(module=>({default:module.ReportsPage})));
const WorkbenchPage = lazy(() => import("./WorkbenchPage").then(module=>({default:module.WorkbenchPage})));
const OverviewPage = lazy(() => import("./OverviewPage").then((module) => ({ default: module.OverviewPage })));
const OrganizationsPage = lazy(() => import("./OrganizationsPage").then((module) => ({ default: module.OrganizationsPage })));
const AuditPage = lazy(() => import("./AuditPage").then((module) => ({ default: module.AuditPage })));
const FormOptionConfigPage = lazy(() => import("./FormOptionConfigPage").then((module) => ({ default: module.FormOptionConfigPage })));
const FileCategoryConfigPage = lazy(() => import("./FileCategoryConfigPage").then((module) => ({ default: module.FileCategoryConfigPage })));
const CharacterPresetsPage = lazy(() => import("./CharacterPresetsPage").then(module => ({ default: module.CharacterPresetsPage })));
const VoiceConfigPage = lazy(() => import("./VoiceConfigPage").then((module) => ({ default: module.VoiceConfigPage })));
const AiSettingsPage = lazy(() => import("./AiSettingsPage").then(module => ({ default: module.AiSettingsPage })));
const HelpCenter = lazy(() => import("@lifewood/ui/help-center").then(module => ({ default: module.HelpCenter })));
const AutomationPage = lazy(() => import("./AutomationPage").then(module => ({default:module.AutomationPage})));
const BackupsPage = lazy(() => import("./BackupsPage").then(module => ({ default: module.BackupsPage })));
const SystemRuntimePage = lazy(() => import("./SystemRuntimePage").then((module) => ({ default: module.SystemRuntimePage })));

type AdminNavIconName = "announcements" | "feedback" | "home" | "overview" | "projects" | "users" | "organizations" | "audit" | "settings";

function AdminNavIcon({ name }: { name: AdminNavIconName }) {
  const paths: Record<AdminNavIconName, ReactNode> = {
    announcements: <path d="M4 9h4l12-5v16L8 15H4V9Zm4 6 2 6h4l-2-4M8 9v6"/>,
    feedback: <><path d="M4 4h16v14H9l-5 3V4Z"/><path d="M8 8h8m-8 4h5"/></>,
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

export function localizedAdminLocation(
  pathname: string,
  search: string,
  hash: string,
  currentLocale: SupportedLocale,
  nextLocale: SupportedLocale,
): string {
  return `${pathname.replace(`/${currentLocale}`, `/${nextLocale}`)}${search}${hash}`;
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
  const { t, i18n } = useTranslation();
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
        {!requiresBootstrap && <ForgotPasswordButton />}
        {!requiresBootstrap && <OtherLoginMethods portal="admin" />}
        <a href={customerPortalUrl(i18n.language === "en-US" ? "en-US" : "zh-CN").replace(/\/tasks$/, "/help")}>{t("help.title")}</a>
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
  const queryClient = useQueryClient();
  const location = useLocation();
  const currentArea = location.pathname.split("/")[2];
  const areaTitles: Record<string, string> = {
    workbench: "operations.workbench",
    reports: "productivity.reports",
    notifications: "notifications.title",
    feedback: "feedback.adminTitle", overview: "admin.nav.overview", projects: "admin.nav.projects",
    invitations: "invitation.title", users: "admin.nav.users", organizations: "admin.nav.organizations",
    automation: "automation.title", announcements: "announcements.manage", help: "help.title", audit: "admin.nav.audit", settings: "admin.nav.settings",
  };
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const accountId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node))
        setAccountOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("dialog"))) {
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
  const languagePreference = useMutation({
    mutationFn: (next: SupportedLocale) => authService.updatePreferences({locale: next}),
    onSuccess: updated => {
      queryClient.setQueryData(["admin-me"], updated);
      queryClient.setQueryData(["current-user"], updated);
    },
  });
  const changeLocale = (next: string) => {
    if (isSupportedLocale(next) && !languagePreference.isPending) languagePreference.mutate(next);
  };
  return (
    <div className="admin-shell" lang={locale}>
      <a className="skip-link" href="#main-content">
        {t("nav.skipToContent")}
      </a>
      <aside className="sidebar">
        <div className="admin-sidebar-brand" aria-label={t("app.name")}>
          <span className="admin-sidebar-brand-mark" aria-hidden="true">LW</span>
          <strong translate="no">{t("app.name")}</strong>
        </div>
        <nav className="admin-navigation" aria-label={t("admin.navGroups.label")}>
          <section className="nav-group" aria-labelledby="nav-group-operations">
            <h2 id="nav-group-operations">{t("admin.navGroups.operations")}</h2>
            <div className="nav-grid">
              {user.permissions.includes("admin.overview.read") && <NavLink to={localizedPath(locale, "/overview")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="overview" /></span>
                <span className="nav-label">{t("admin.nav.overview")}</span>
              </NavLink>}
              <NavLink to={localizedPath(locale, "/workbench")}><span className="nav-icon" aria-hidden="true"><AdminNavIcon name="overview" /></span><span className="nav-label">{t("operations.workbench")}</span></NavLink>
              {user.permissions.includes("admin.announcements.manage") && <NavLink to={localizedPath(locale, "/automation")}><span className="nav-icon" aria-hidden="true"><AdminNavIcon name="audit"/></span><span className="nav-label">{t("automation.title")}</span></NavLink>}
              {user.permissions.includes("admin.announcements.manage") && <NavLink to={localizedPath(locale, "/announcements")}><span className="nav-icon" aria-hidden="true"><AdminNavIcon name="announcements"/></span><span className="nav-label">{t("announcements.manage")}</span></NavLink>}
              {user.permissions.includes("admin.feedback.manage")&&<NavLink to={localizedPath(locale,"/feedback")}><span className="nav-icon" aria-hidden="true"><AdminNavIcon name="feedback"/></span><span className="nav-label">{t("feedback.adminTitle")}</span></NavLink>}
              <NavLink to={localizedPath(locale, "/projects")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="projects" /></span>
                <span className="nav-label">{t("admin.nav.projects")}</span>
              </NavLink>
            </div>
          </section>
          {user.permissions.includes("admin.users.manage") && <section className="nav-group" aria-labelledby="nav-group-directory">
            <h2 id="nav-group-directory">{t("admin.navGroups.directory")}</h2>
            <div className="nav-grid">
              <NavLink to={localizedPath(locale, "/users")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="users" /></span>
                <span className="nav-label">{t("admin.nav.users")}</span>
              </NavLink>
              <NavLink to={localizedPath(locale, "/invitations")}><span className="nav-icon" aria-hidden="true"><AdminNavIcon name="users" /></span><span className="nav-label">{t("invitation.title")}</span></NavLink>
              <NavLink to={localizedPath(locale, "/organizations")}>
                <span className="nav-icon" aria-hidden="true"><AdminNavIcon name="organizations" /></span>
                <span className="nav-label">{t("admin.nav.organizations")}</span>
              </NavLink>
            </div>
          </section>}
          {user.permissions.includes("admin.config.manage") && <section className="nav-group" aria-labelledby="nav-group-governance">
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
          </section>}
          <NavLink to={localizedPath(locale, "/help?audience=admin")}><span className="nav-icon" aria-hidden="true">?</span><span className="nav-label">{t("help.title")}</span></NavLink>
        </nav>
      </aside>
      <div className="workspace">
        <header className={`topbar ${currentArea==="notifications"?"notification-topbar":""}`}>
          <div className="topbar-leading">
            {user.permissions.includes("tasks.read") && <a className="topbar-home" href={`/api/portals/customer?locale=${locale}`} aria-label={t("admin.nav.home")} title={t("admin.nav.home")}>
              <AdminNavIcon name="home" /><span>{t("admin.nav.home")}</span>
            </a>}
            <span className="topbar-title">{t(areaTitles[currentArea] ?? "admin.internalWorkspace")}</span>
          </div>
          <FunctionSearch key={user.id} user={user} locale={locale} />
          <div className="topbar-actions"><NotificationBell key={user.id} admin/>
            <label>
              <span className="sr-only">{t("nav.language")}</span>
              <select
                value={locale}
                disabled={languagePreference.isPending}
                onChange={(event) => changeLocale(event.target.value)}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            {languagePreference.isError && <span className="admin-account-error" role="alert">{localizedApiError(languagePreference.error, t)}</span>}
            <div className="admin-account portal-account-control" ref={accountRef}>
              <a className="admin-avatar-trigger" href={`/api/portals/profile?locale=${locale}`} aria-label={t("nav.profile")}>
                <img className="account-avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" />
              </a>
              <button
                ref={accountTriggerRef}
                className="admin-account-trigger portal-account-trigger"
                type="button"
                aria-haspopup="dialog"
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
                  className="admin-account-popover portal-account-menu"
                  role="dialog"
                  aria-label={t("nav.account")}
                >
                  <div className="admin-account-identity portal-account-identity">
                    <a className="admin-account-avatar-preview" href={`/api/portals/profile?locale=${locale}`} aria-label={t("nav.profile")}>
                      <img className="account-avatar account-avatar-large" src={user.avatarUrl || "/api/me/avatar"} alt="" width="46" height="46" />
                    </a>
                    <div><strong>{user.displayName}</strong>{user.email && <span>{user.email}</span>}{user.organization?.name && <span>{user.organization.name}</span>}</div>
                  </div>
                  <a className="portal-account-action" href={`/api/portals/profile?locale=${locale}`}>
                    {t("nav.profile")}
                  </a>
                  <AccountSwitcher user={user} destination={next=>next.permissions.includes("admin.access")?`${import.meta.env.BASE_URL.replace(/\/$/, "")}/${locale}/projects`:`/api/portals/customer?locale=${locale}`}/>
                  <button
                    className="portal-account-action"
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
      <UserPresence key={`presence-${user.id}`} userId={user.id}/><AccountSessionGuard key={user.id} userId={user.id}/>
      <ToastHost />

    </div>
  );
}

function AdminRoot() {
  const location = useLocation();
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
      <><AccountLocaleRedirect locale={me.data.locale}/><main className="center-state">
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
      </main></>
    );
  const area = location.pathname.split(`/${locale}/`)[1]?.split("/")[0] ?? "";
  const announcementPicker = area === "organizations" && new URLSearchParams(location.search).get("pick") === "announcement" && !!readNoticeDraft(location.state, me.data.id);
  const required = announcementPicker ? "admin.announcements.manage" : area === "settings" && location.pathname.replace(/\/+$/, "").endsWith("/settings/announcements") ? "admin.announcements.manage" : ({ automation: "admin.announcements.manage", announcements: "admin.announcements.manage", feedback: "admin.feedback.manage", reports: "admin.projects.read", workbench: "admin.projects.read", overview: "admin.overview.read", invitations: "admin.users.manage", users: "admin.users.manage", organizations: "admin.users.manage", audit: "admin.audit.read", settings: "admin.config.manage", voices: "admin.config.manage", projects: "admin.projects.read" } as Record<string,string>)[area];
  const home = me.data.permissions.includes("admin.overview.read") ? "overview" : "workbench";
  return (
    <><AccountLocaleRedirect locale={me.data.locale}/><AdminShell user={me.data} locale={locale}>
      {required && !me.data.permissions.includes(required) ? <Navigate replace to={localizedPath(locale, "/" + home)} /> :
      <Suspense fallback={<main className="center-state" role="status" aria-busy="true">{t("common.loading")}</main>}>
        <Routes>
        <Route path="help" element={<HelpCenter key={me.data.id} userId={me.data.id} locale={locale} canReadAdmin={me.data.permissions.includes("admin.access")} />} />
        <Route index element={<Navigate replace to={home} />} />
        <Route path="notifications" element={<NotificationCenter key={me.data.id} admin/>}/><Route path="settings/notifications" element={<NotificationSettingsPage/>}/>
        <Route path="overview" element={<OverviewPage locale={locale} />} />
        <Route path="reports" element={<ReportsPage locale={locale}/>}/>
        <Route path="workbench" element={<WorkbenchPage locale={locale} permissions={me.data.permissions} userId={me.data.id}/>} />
        <Route path="projects" element={<ProjectsPage locale={locale} user={me.data} />} />
        <Route path="invitations" element={<InvitationsPage key={me.data.id} locale={locale}/>}/>
        <Route path="users" element={<UsersPage locale={locale} currentUserId={me.data.id} />} />
        <Route path="feedback" element={<FeedbackPage key={me.data.id} userId={me.data.id} locale={locale}/>}/>
        <Route path="organizations" element={<OrganizationsPage key={me.data.id} userId={me.data.id} locale={locale} />} />
        <Route path="audit" element={<AuditPage key={me.data.id} locale={locale} userId={me.data.id} />} />
        <Route path="automation" element={<AutomationPage key={me.data.id} locale={locale} userId={me.data.id} canBackup={me.data.permissions.includes("admin.runtime.manage")}/>}/>
        <Route path="announcements" element={<AnnouncementsPage key={me.data.id} userId={me.data.id} locale={locale} />} />
        <Route path="settings/announcements" element={<Navigate replace to={localizedPath(locale, "/announcements") + location.search + location.hash} state={location.state}/>} />
        <Route path="settings/characters" element={<CharacterPresetsPage locale={locale} imageBase={customerPortalUrl(locale)} />} />
        <Route path="settings/ai" element={<AiSettingsPage locale={locale} />} />
        <Route path="settings/oidc" element={<OidcSettingsPage key={me.data.id} locale={locale} allowed={me.data.roles.includes("owner")} />} />
        <Route path="settings/mail/templates" element={<MailTemplatePage key={me.data.id} locale={locale} allowed={me.data.roles.includes("owner")} />} />
        <Route path="settings/mail" element={<MailStatusPage key={me.data.id} locale={locale} allowed={me.data.roles.includes("owner")} />} />
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
        <Route path="settings/backups" element={<BackupsPage key={me.data.id} locale={locale} userId={me.data.id} allowed={me.data.permissions.includes("admin.runtime.manage")} />} />
        <Route
          path="settings/runtime"
          element={<SystemRuntimePage key={me.data.id} locale={locale} userId={me.data.id} />}
        />
        <Route
          path="voices"
          element={
            <Navigate replace to={localizedPath(locale, "/settings/voices")} />
          }
        />
        <Route path="*" element={<Navigate replace to={home} />} />
        </Routes>
      </Suspense>}
    </AdminShell></>
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
