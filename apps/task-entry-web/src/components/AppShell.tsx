import { useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";

function switchLocale(pathname: string, locale: SupportedLocale): string {
  const parts = pathname.split("/");
  parts[1] = locale;
  return parts.join("/") || `/${locale}/tasks`;
}

export function adminCenterUrl(locale: SupportedLocale, configuredBase = import.meta.env.VITE_ADMIN_APP_URL): string {
  const base = configuredBase?.trim()
    || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5174` : "/admin");
  return `${base.replace(/\/$/, "")}/${locale}/projects`;
}

function LeafMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M19.8 4.2C12.8 4.4 7.1 7.1 5.3 12c-1 2.8-.2 5.7 2 7.5 1.6-4.8 4.7-8.2 9.2-10.3-3.8 2.7-6.3 6.2-7.5 10.5 3.1.7 6.2-.6 8.2-3.4 2.1-3 2.7-7.2 2.6-12.1Z" fill="currentColor" />
    </svg>
  );
}

export function AppShell({ user, children }: PropsWithChildren<{ user: CurrentUser }>) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountPopoverId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const logout = useMutation({
    mutationFn: authService.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["current-user"] });
      if (isSupportedLocale(locale)) navigate(`/${locale}/login`, { replace: true });
    },
  });

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  if (!isSupportedLocale(locale)) return null;
  const confirmLeave = () => document.body.dataset.unsavedChanges !== "true" || window.confirm(t("wizard.unsavedChanges"));
  const canAccessAdmin = user.permissions.includes("admin.access");

  return (
    <div className="app-shell reference-shell">
      <a className="skip-link" href="#main-content">{t("nav.skipToContent")}</a>
      <header className="topbar reference-topbar">
        <Link className="brand" to={`/${locale}/tasks`} aria-label={t("app.name")} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
          <span className="brand-mark"><LeafMark /></span>
          <span className="brand-text">
            <strong>{t("app.name")}</strong>
            <span>{t("nav.workspace")}</span>
          </span>
        </Link>

        <nav className="nav-links" aria-label={t("nav.tasks")}>
          <NavLink to={`/${locale}/tasks`} className={({ isActive }) => isActive ? "active" : undefined} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
            {t("nav.tasks")}
          </NavLink>
        </nav>

        <div className="topbar-actions">
          {canAccessAdmin ? (
            <a className="admin-entry" href={adminCenterUrl(locale)} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
              <span className="admin-entry-icon" aria-hidden="true">⚙</span>
              <span>{t("nav.adminCenter")}</span>
            </a>
          ) : null}
          <label className="locale-control reference-language">
            <span className="language-icon" aria-hidden="true">文</span>
            <span className="sr-only">{t("nav.language")}</span>
            <select
              name="locale"
              autoComplete="off"
              value={locale}
              onChange={(event) => {
                if (confirmLeave()) navigate(switchLocale(location.pathname, event.target.value as SupportedLocale) + location.search);
                else event.target.value = locale;
              }}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </label>

          <div className="account-menu" ref={accountRef}>
            <button
              ref={accountTriggerRef}
              className="profile-chip"
              type="button"
              aria-expanded={accountOpen}
              aria-controls={accountPopoverId}
              aria-label={t("nav.accountMenu", { name: user.displayName })}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <img className="avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="28" height="28" />
              <span className="user-name">{user.displayName}</span>
              <span className="account-chevron" aria-hidden="true">⌄</span>
            </button>
            {accountOpen ? (
              <div id={accountPopoverId} className="account-popover" role="region" aria-label={t("nav.account")}>
                <div className="account-identity">
                  <strong>{user.displayName}</strong>
                  {user.email ? <span>{user.email}</span> : null}
                  {user.organization?.name ? <small>{user.organization.name}</small> : null}
                </div>
                <button className="account-action" type="button" disabled={logout.isPending} onClick={() => { if (confirmLeave()) logout.mutate(); }}>
                  {logout.isPending ? t("nav.loggingOut") : t("nav.logout")}
                </button>
                {logout.isError ? <p className="account-error" role="alert">{t("nav.logoutFailed")}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
