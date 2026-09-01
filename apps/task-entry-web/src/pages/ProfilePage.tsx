import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { SupportedLocale } from "@lifewood/domain";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";

const AvatarEditor = lazy(() => import("@lifewood/ui/avatar-editor").then((module) => ({ default: module.AvatarEditor })));

export function ProfilePage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userQuery = useQuery({ queryKey: ["current-user"], queryFn: authService.getCurrentUser, retry: false });
  const user = userQuery.data;
  const [displayName, setDisplayName] = useState<string>();
  const [clientName, setClientName] = useState<string>();
  const [phone, setPhone] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

  const updateProfile = useMutation({
    mutationFn: () => authService.updateProfile({
      displayName: (displayName ?? user?.displayName ?? "").trim(),
      clientName: (clientName ?? user?.clientName ?? user?.organization?.name ?? user?.displayName ?? "").trim(),
      phone: (phone ?? user?.phone ?? "").trim(),
    }),
    onMutate: () => setSaved(false),
    onSuccess: (updated) => {
      queryClient.setQueryData(["current-user"], updated);
      setDisplayName(updated.displayName);
      setClientName(updated.clientName ?? "");
      setPhone(updated.phone ?? "");
      setSaved(true);
    },
  });
  const avatarUpdate = useMutation({
    mutationFn: (action: { file?: File; remove?: boolean }) => action.remove ? authService.removeAvatar() : authService.uploadAvatar(action.file!),
    onSuccess: (updated) => {
      queryClient.setQueryData(["current-user"], updated);
      setAvatarOpen(false);
    },
  });
  const updatePreferences = useMutation({
    mutationFn: (nextLocale: SupportedLocale) => authService.updatePreferences({ locale: nextLocale }),
    onSuccess: (updated, nextLocale) => {
      queryClient.setQueryData(["current-user"], updated);
      navigate(localizedPath(nextLocale, "/profile"), { replace: true });
    },
  });

  const currentDisplayName = displayName ?? user?.displayName ?? "";
  const currentClientName = clientName ?? user?.clientName ?? user?.organization?.name ?? user?.displayName ?? "";
  const currentPhone = phone ?? user?.phone ?? "";
  const storedClientName = user?.clientName ?? user?.organization?.name ?? user?.displayName ?? "";
  const unchanged = !user || (currentDisplayName.trim() === user.displayName && currentClientName.trim() === storedClientName && currentPhone.trim() === (user.phone ?? ""));
  const dirty = Boolean(user) && !unchanged;
  useEffect(() => {
    document.body.dataset.unsavedChanges = String(dirty);
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const preventBackLoss = () => { if (dirty && !window.confirm(t("wizard.unsavedChanges"))) window.history.go(1); };
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("popstate", preventBackLoss);
    return () => {
      window.removeEventListener("beforeunload", preventLoss);
      window.removeEventListener("popstate", preventBackLoss);
      delete document.body.dataset.unsavedChanges;
    };
  }, [dirty, t]);

  if (!isSupportedLocale(locale)) return null;
  if (userQuery.isPending || !user) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  const guardLink = (event: MouseEvent<HTMLAnchorElement>) => { if (dirty && !window.confirm(t("wizard.unsavedChanges"))) event.preventDefault(); };
  const role = user.roles[0] ?? "member";
  const roleLabel = t(`profile.roles.${role}`, { defaultValue: t("profile.roles.member") });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unchanged) updateProfile.mutate();
  };

  return (
    <div className="page profile-page">
      <header className="profile-identity">
        <Link className="profile-back-link" to={`/${locale}/tasks`} onClick={guardLink}>← {t("profile.backToProjects")}</Link>
        <div className="profile-person">
          <button ref={avatarButtonRef} className="profile-portrait" type="button" aria-label={t("profile.changeAvatar")} onClick={() => setAvatarOpen(true)}>
            <img src={user.avatarUrl || "/api/me/avatar"} alt="" width="104" height="104" />
            <span className="profile-portrait-action" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7.5 8.4 5h7.2L17 7.5h2.2A1.8 1.8 0 0 1 21 9.3v8.9a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.2V9.3a1.8 1.8 0 0 1 1.8-1.8H7Zm5 10a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4Z" fill="currentColor" /></svg>
            </span>
          </button>
          <div className="profile-person-copy">
            <span className="profile-eyebrow">{t("profile.identityEyebrow")}</span>
            <h1>{user.displayName}</h1>
            <p>{user.organization?.name || t("profile.notAssigned")}</p>
            <div className="profile-identity-meta">
              <span>{roleLabel}</span>
              {user.email ? <span>{user.email}</span> : null}
            </div>
          </div>
        </div>
        <div className="profile-intake-note">
          <span className="profile-intake-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19"><path d="M6 3.5h9.5L19 7v13.5H6v-17Zm9 1.8V8h2.7M9 12h7M9 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span><strong>{t("profile.intakeTitle")}</strong><small>{t("profile.intakeDescription")}</small></span>
        </div>
      </header>

      <div className="profile-layout">
        <form className="profile-surface profile-form" onSubmit={submit} aria-labelledby="profile-contact-title" aria-busy={updateProfile.isPending}>
          <div className="profile-section-heading">
            <span className="profile-section-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.5-4 2.8-6 7-6s6.5 2 7 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </span>
            <span><h2 id="profile-contact-title">{t("profile.contactTitle")}</h2><p>{t("profile.contactDescription")}</p></span>
          </div>
          <div className="profile-fields">
            <label className="profile-field" htmlFor="profile-client-name">
              <span>{t("profile.clientName")}</span>
              <input id="profile-client-name" name="clientName" type="text" autoComplete="organization" required maxLength={200} value={currentClientName} onChange={(event) => { setClientName(event.target.value); setSaved(false); }} />
            </label>
            <label className="profile-field" htmlFor="profile-display-name">
              <span>{t("profile.displayName")}</span>
              <input id="profile-display-name" name="displayName" type="text" autoComplete="name" required minLength={2} maxLength={100} value={currentDisplayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }} />
            </label>
            <label className="profile-field" htmlFor="profile-phone">
              <span>{t("profile.phone")}</span>
              <input id="profile-phone" name="phone" type="tel" autoComplete="tel" maxLength={50} value={currentPhone} onChange={(event) => { setPhone(event.target.value); setSaved(false); }} placeholder={t("profile.phonePlaceholder")} />
            </label>
          </div>
          {updateProfile.isError ? <p className="inline-error" role="alert">{localizedApiError(updateProfile.error, t)}</p> : null}
          {saved ? <p className="profile-success" role="status">{t("profile.saved")}</p> : null}
          <div className="profile-actions">
            <button className="button button-primary" type="submit" disabled={updateProfile.isPending || unchanged}>{updateProfile.isPending ? t("common.saving") : t("profile.save")}</button>
          </div>
        </form>

        <div className="profile-side-stack">
          <aside className="profile-surface profile-account" aria-labelledby="profile-account-title">
            <div className="profile-section-heading">
              <span className="profile-section-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 10V8a6 6 0 0 1 12 0v2m-13 0h14v10H5V10Zm7 4v2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span><h2 id="profile-account-title">{t("profile.accountTitle")}</h2><p>{t("profile.accountDescription")}</p></span>
            </div>
            <dl className="profile-account-list">
              <div><dt>{t("profile.email")}</dt><dd>{user.email || t("profile.notSet")}</dd></div>
              <div><dt>{t("profile.organization")}</dt><dd>{user.organization?.name || t("profile.notAssigned")}</dd></div>
            </dl>
            <p className="profile-account-note">{t("profile.readonlyNote")}</p>
            <div className="profile-security-row">
              <span><strong>{t("profile.passwordTitle")}</strong><small>{t("profile.passwordDescription")}</small></span>
              <button className="profile-security-action" type="button" onClick={() => setPasswordOpen(true)}>{t("nav.changePassword")}</button>
            </div>
          </aside>

          <section className="profile-surface profile-preferences" aria-labelledby="profile-preferences-title" aria-busy={updatePreferences.isPending}>
            <div className="profile-section-heading">
              <span className="profile-section-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.2 3.3 8.5S14.2 18.2 12 20.5C9.8 18.2 8.7 15.3 8.7 12S9.8 5.8 12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              </span>
              <span><h2 id="profile-preferences-title">{t("profile.preferencesTitle")}</h2><p>{t("profile.preferencesDescription")}</p></span>
            </div>
            <label className="profile-language-field" htmlFor="profile-language">
              <span><strong>{t("profile.language")}</strong><small>{t("profile.languageDescription")}</small></span>
              <select
                id="profile-language"
                name="locale"
                value={user.locale ?? locale}
                disabled={updatePreferences.isPending}
                onChange={(event) => {
                  const nextLocale = event.target.value as SupportedLocale;
                  if (dirty && !window.confirm(t("wizard.unsavedChanges"))) {
                    event.currentTarget.value = user.locale ?? locale;
                    return;
                  }
                  updatePreferences.mutate(nextLocale);
                }}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <div className="profile-preference-feedback" aria-live="polite">
              {updatePreferences.isPending ? <span>{t("profile.preferenceSaving")}</span> : null}
              {updatePreferences.isSuccess ? <span>{t("profile.preferenceSaved")}</span> : null}
              {updatePreferences.isError ? <span className="field-error" role="alert">{localizedApiError(updatePreferences.error, t)}</span> : null}
            </div>
          </section>
        </div>
      </div>

      {passwordOpen ? <ChangePasswordDialog onClose={() => setPasswordOpen(false)} /> : null}
      {avatarOpen ? <Suspense fallback={null}><AvatarEditor
        avatarUrl={user.avatarUrl || "/api/me/avatar"}
        displayName={user.displayName}
        hasCustomAvatar={Boolean(user.hasCustomAvatar)}
        busy={avatarUpdate.isPending}
        error={avatarUpdate.isError ? t("nav.avatarFailed") : undefined}
        onClose={() => { if (!avatarUpdate.isPending) { setAvatarOpen(false); avatarUpdate.reset(); } }}
        onSave={(file) => avatarUpdate.mutate({ file })}
        onRemove={() => { if (window.confirm(t("nav.removeAvatarConfirm"))) avatarUpdate.mutate({ remove: true }); }}
        returnFocus={avatarButtonRef.current}
        labels={{
          title: t("nav.avatarEditorTitle"), close: t("common.close"), choose: t("nav.chooseAvatar"), chooseAnother: t("nav.chooseAnotherAvatar"),
          instruction: t("nav.avatarCropInstruction"), zoom: t("nav.avatarZoom"), cancel: t("common.cancel"), save: t("nav.saveAvatar"),
          saving: t("nav.avatarUploading"), remove: t("nav.removeAvatar"), invalidImage: t("nav.avatarSourceInvalid"),
        }}
      /></Suspense> : null}
    </div>
  );
}
