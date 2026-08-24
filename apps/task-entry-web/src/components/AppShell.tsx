import type { PropsWithChildren } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { authService, localAuthService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";

function switchLocale(pathname: string, locale: SupportedLocale): string {
  const parts = pathname.split("/");
  parts[1] = locale;
  return parts.join("/") || `/${locale}/tasks`;
}

export function AppShell({ user, children }: PropsWithChildren<{ user: CurrentUser }>) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => __LOCAL_AUTH__ ? localAuthService.logout() : authService.logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["current-user"] });
      if (isSupportedLocale(locale)) navigate(`/${locale}/login`, { replace: true });
    },
  });

  if (!isSupportedLocale(locale)) return null;
  const initials = user.displayName.trim().slice(0, 2).toUpperCase();
  const confirmLeave = () => document.body.dataset.unsavedChanges !== "true" || window.confirm(t("wizard.unsavedChanges"));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t("nav.skipToContent")}</a>
      <header className="app-bar">
        <Link className="wordmark" to={`/${locale}/tasks`} aria-label={t("app.name")} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
          <span className="wordmark-mark" aria-hidden="true">L</span>
          <span>{t("app.name")}</span>
        </Link>
        <div className="app-tools">
          <label className="locale-control">
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
          <div className="user-chip">
            {user.avatarUrl ? <img className="avatar" src={user.avatarUrl} alt="" width="30" height="30" /> : <span className="avatar" aria-hidden="true">{initials}</span>}
            <span className="user-name">{user.displayName}</span>
          </div>
          <button className="button button-quiet" type="button" onClick={() => { if (confirmLeave()) logout.mutate(); }}>
            {t("nav.logout")}
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
