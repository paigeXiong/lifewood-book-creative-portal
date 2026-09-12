import {FeedbackButton} from "./FeedbackButton";
import { PortalNavigation } from "./PortalNavigation";
import {UserPresence} from "@lifewood/ui/user-presence";
import {AccountSwitcher,AccountSessionGuard} from "@lifewood/ui/account-switcher";
import {NotificationBell} from "@lifewood/ui/notifications";
import { LoginBookBackdrop } from "./LoginBookBackdrop";
import { Announcements } from "./Announcements";
import { useConfirm, useConfirmLink } from "../useConfirm";
import { useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import { clearUserProjectQueries } from "../projectQueryCache";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";

export function adminCenterUrl(locale: SupportedLocale, configuredBase = import.meta.env.VITE_ADMIN_APP_URL): string {
  if (!configuredBase?.trim() && !import.meta.env.DEV) return `/api/portals/admin?locale=${locale}`;
  const base = configuredBase?.trim()
    || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5174` : "/admin");
  return `${base.replace(/\/$/, "")}/${locale}/projects`;
}

export function AppShell({ user, children }: PropsWithChildren<{ user: CurrentUser }>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const guardLink = useConfirmLink();
  const { locale } = useParams();
  const location = useLocation();
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
      if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("dialog"))) {
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
  const confirmLeave = async () => document.body.dataset.unsavedChanges !== "true" || await confirm(t("wizard.unsavedChanges"), false);
  const canAccessAdmin = user.permissions.includes("admin.access");

  return (
    <div className="app-shell reference-shell">
      {location.pathname.replace(/\/$/, "") === `/${locale}/tasks` && user.taskBackgroundMotion !== false && <LoginBookBackdrop subtle />}
      <a className="skip-link" href="#main-content">{t("nav.skipToContent")}</a>
      <header className="topbar reference-topbar">
        <Link className="brand" to={`/${locale}/tasks`} aria-label={t("app.name")} onClick={guardLink}>
          <img className="brand-logo" src="/lifewood-logo.png" alt="" width="2285" height="492" />
          <span className="brand-text">
            <strong translate="no">{t("app.clientName")}</strong>
          </span>
        </Link>

        <PortalNavigation label={t("nav.tasks")}>
          <NavLink className="portal-projects-link" to={`/${locale}/tasks`} onClick={event => guardLink(event, () => setAccountOpen(false))}>
            <span>{t("nav.tasks")}</span>
          </NavLink>
        </PortalNavigation>
        <div className="topbar-actions">
          <FeedbackButton key={user.id} locale={locale}/><NotificationBell key={`notifications-${user.id}`}/><Announcements key={user.id} userId={user.id} locale={locale} />
          {canAccessAdmin ? (
            <a className="admin-entry" href={`/api/portals/admin?locale=${locale}`} aria-label={t("nav.adminCenter")} onClick={event => guardLink(event, undefined, true)}>
              <span className="admin-entry-icon" aria-hidden="true">⚙</span>
              <span>{t("nav.adminCenter")}</span>
            </a>
          ) : null}
          <div className="account-menu portal-account-control" ref={accountRef}>
            <Link className="avatar-trigger" to={`/${locale}/profile`} aria-label={t("nav.profile")} onClick={event => guardLink(event, () => setAccountOpen(false))}>
              <img className="avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" />
            </Link>
            <button
              ref={accountTriggerRef}
              className="profile-chip portal-account-trigger"
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
              <div id={accountPopoverId} className="account-popover portal-account-menu" role="dialog" aria-label={t("nav.account")}>
                <div className="account-identity portal-account-identity">
                  <Link className="account-avatar-preview" to={`/${locale}/profile`} aria-label={t("nav.profile")} onClick={event => guardLink(event, () => setAccountOpen(false))}>
                    <img className="avatar avatar-large" src={user.avatarUrl || "/api/me/avatar"} alt="" width="46" height="46" />
                  </Link>
                  <div><strong>{user.displayName}</strong>{user.email ? <span>{user.email}</span> : null}{user.organization?.name ? <small>{user.organization.name}</small> : null}</div>
                </div>
                <Link className="account-action portal-account-action" to={`/${locale}/profile`} onClick={event => guardLink(event, () => setAccountOpen(false))}>
                  {t("nav.profile")}
                </Link>
                <AccountSwitcher user={user} destination={()=>`/${locale}/tasks`}/>
                <button className="account-action portal-account-action" type="button" disabled={logout.isPending} onClick={async () => { if (await confirmLeave()) logout.mutate(); }}>
                  {logout.isPending ? t("nav.loggingOut") : t("nav.logout")}
                </button>
                {logout.isError ? <p className="account-error" role="alert">{t("nav.logoutFailed")}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <UserPresence key={`presence-${user.id}`} userId={user.id}/><AccountSessionGuard key={user.id} userId={user.id}/>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
