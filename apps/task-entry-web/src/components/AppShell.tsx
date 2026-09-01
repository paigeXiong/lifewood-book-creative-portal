import { lazy, Suspense, useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import { clearUserProjectQueries } from "../projectQueryCache";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";

const AvatarEditor = lazy(() => import("@lifewood/ui/avatar-editor").then((module) => ({ default: module.AvatarEditor })));

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
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountPopoverId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const avatarTriggerRef = useRef<HTMLButtonElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<string>();
  const avatarUpdate = useMutation({
    mutationFn: (action: { file?: File; remove?: boolean }) => action.remove ? authService.removeAvatar() : authService.uploadAvatar(action.file!),
    onMutate: () => setAvatarFeedback(undefined),
    onSuccess: (updated, action) => {
      queryClient.setQueryData(["current-user"], updated);
      setAvatarFeedback(t(action.remove ? "nav.avatarRemoved" : "nav.avatarUpdated"));
      setAvatarEditorOpen(false);
    },
  });
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

  useEffect(() => {
    if (!avatarFeedback) return;
    const timer = window.setTimeout(() => setAvatarFeedback(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [avatarFeedback]);

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

        <div className="topbar-actions">
          {canAccessAdmin ? (
            <a className="admin-entry" href={adminCenterUrl(locale)} aria-label={t("nav.adminCenter")} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
              <span className="admin-entry-icon" aria-hidden="true">⚙</span>
              <span>{t("nav.adminCenter")}</span>
            </a>
          ) : null}
          <div className="account-menu" ref={accountRef}>
            <button ref={avatarTriggerRef} className="avatar-trigger" type="button" aria-label={t("nav.openAvatarEditor")} onClick={() => { setAccountOpen(false); setAvatarEditorOpen(true); }}>
              <img className="avatar" src={user.avatarUrl || "/api/me/avatar"} alt="" width="30" height="30" />
            </button>
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
                  <button type="button" className="account-avatar-preview" aria-label={t("nav.openAvatarEditor")} onClick={() => { setAccountOpen(false); setAvatarEditorOpen(true); }}>
                    <img className="avatar avatar-large" src={user.avatarUrl || "/api/me/avatar"} alt="" width="46" height="46" />
                  </button>
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
      {avatarFeedback ? <p className="avatar-update-toast" role="status" aria-live="polite">{avatarFeedback}</p> : null}
      <main id="main-content" tabIndex={-1}>{children}</main>
      {avatarEditorOpen ? <Suspense fallback={null}><AvatarEditor
        avatarUrl={user.avatarUrl || "/api/me/avatar"}
        displayName={user.displayName}
        hasCustomAvatar={Boolean(user.hasCustomAvatar)}
        busy={avatarUpdate.isPending}
        error={avatarUpdate.isError ? t("nav.avatarFailed") : undefined}
        onClose={() => { if (!avatarUpdate.isPending) { setAvatarEditorOpen(false); avatarUpdate.reset(); } }}
        onSave={(file) => avatarUpdate.mutate({ file })}
        onRemove={() => { if (window.confirm(t("nav.removeAvatarConfirm"))) avatarUpdate.mutate({ remove: true }); }}
        returnFocus={avatarTriggerRef.current}
        labels={{
          title: t("nav.avatarEditorTitle"), close: t("common.close"), choose: t("nav.chooseAvatar"), chooseAnother: t("nav.chooseAnotherAvatar"),
          instruction: t("nav.avatarCropInstruction"), zoom: t("nav.avatarZoom"), cancel: t("common.cancel"), save: t("nav.saveAvatar"),
          saving: t("nav.avatarUploading"), remove: t("nav.removeAvatar"), invalidImage: t("nav.avatarSourceInvalid"),
        }}
      /></Suspense> : null}
    </div>
  );
}
