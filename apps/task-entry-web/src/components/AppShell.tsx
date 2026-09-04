import { useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import { clearUserProjectQueries } from "../projectQueryCache";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";

export function adminCenterUrl(locale: SupportedLocale, configuredBase = import.meta.env.VITE_ADMIN_APP_URL): string {
  const base = configuredBase?.trim()
    || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5174` : "/admin");
  return `${base.replace(/\/$/, "")}/${locale}/projects`;
}

export function AppShell({ user, children }: PropsWithChildren<{ user: CurrentUser }>) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountPopoverId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const logout = useMutation({
    mutationFn: authService.logout,
    onSuccess: async () => {
      clearUserProjectQueries(queryClient);
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
          <img className="brand-logo" src="/lifewood-logo.png" alt="" width="2285" height="492" />
          <span className="brand-text">
            <strong translate="no">{t("app.clientName")}</strong>
          </span>
        </Link>

        <div className="topbar-actions">
          {canAccessAdmin ? (
            <a className="admin-entry" href={adminCenterUrl(locale)} aria-label={t("nav.adminCenter")} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
              <span className="admin-entry-icon" aria-hidden="true">⚙</span>
              <span>{t("nav.adminCenter")}</span>
            </a>
          ) : null}
          <div className="account-menu" ref={accountRef}>
            <Link className="avatar-trigger" to={`/${locale}/profile`} aria-label={t("nav.profile")} onClick={(event) => { if (confirmLeave()) setAccountOpen(false); else event.preventDefault(); }}>
              <img className="avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" />
            </Link>
            <button
              ref={accountTriggerRef}
              className="profile-chip"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              aria-controls={accountPopoverId}
              aria-label={t("nav.accountMenu", { name: user.displayName })}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <span className="user-name">{user.displayName}</span>
              <span className="account-chevron" aria-hidden="true">⌄</span>
            </button>
            {accountOpen ? (
              <div id={accountPopoverId} className="account-popover" role="dialog" aria-label={t("nav.account")}>
                <div className="account-identity">
                  <Link className="account-avatar-preview" to={`/${locale}/profile`} aria-label={t("nav.profile")} onClick={(event) => { if (confirmLeave()) setAccountOpen(false); else event.preventDefault(); }}>
                    <img className="avatar avatar-large" src={user.avatarUrl || "/api/me/avatar"} alt="" width="46" height="46" />
                  </Link>
                  <div><strong>{user.displayName}</strong>{user.email ? <span>{user.email}</span> : null}{user.organization?.name ? <small>{user.organization.name}</small> : null}</div>
                </div>
                <Link className="account-action" to={`/${locale}/profile`} onClick={(event) => { if (confirmLeave()) setAccountOpen(false); else event.preventDefault(); }}>
                  {t("nav.profile")}
                </Link>
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
