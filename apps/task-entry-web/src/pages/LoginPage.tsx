import { HelpPopover } from "@lifewood/ui/help-popover";
import { Announcements } from "../components/Announcements";
import { ForgotPasswordButton } from "@lifewood/ui/email";
import { OtherLoginMethods } from "@lifewood/ui/oidc";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { authService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { clearUserProjectQueries } from "../projectQueryCache";
import { LoginStory } from "../components/LoginStory";
import { LoginBookBackdrop } from "../components/LoginBookBackdrop";
import "./login-account-actions.css";
import { InvitationRegistrationPage } from "./InvitationRegistrationPage";

export function LoginPage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(()=>typeof location.state?.registrationEmail === "string" ? location.state.registrationEmail : "");
  useEffect(()=>{if(typeof location.state?.registrationEmail==="string")setEmail(location.state.registrationEmail);},[location.state]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [clientError, setClientError] = useState<string>();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: authService.getStatus, retry: false });
  const requiresBootstrap = status.data?.requiresBootstrap === true;
  const registering = location.pathname.endsWith("/register") && !requiresBootstrap;
  const authenticate = useMutation({
    mutationFn: () => requiresBootstrap
      ? authService.bootstrap({ displayName, email, password, phone, organizationName, locale: isSupportedLocale(locale) ? locale : undefined })
      : authService.login({ email, password, rememberMe }),
    onSuccess: async (user) => {
      clearUserProjectQueries(queryClient);
      queryClient.setQueryData(["current-user"], user);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      const preferredLocale = user.locale ?? (isSupportedLocale(locale) ? locale : "zh-CN");
      const fallback = localizedPath(preferredLocale, "/tasks");
      const target = (location.state as { from?: string } | null)?.from ?? fallback;
      navigate(target.replace(/^\/(zh-CN|en-US)(?=\/|$)/, `/${preferredLocale}`), { replace: true });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClientError(undefined);
    if (requiresBootstrap && password !== confirmPassword) {
      setClientError(t("auth.passwordMismatch"));
      document.getElementById("confirm-password")?.focus();
      return;
    }
    authenticate.mutate();
  };

  if (!isSupportedLocale(locale)) return null;
  const otherLocale = locale === "zh-CN" ? "en-US" : "zh-CN";

  return (
    <main className="login-page">
      {isSupportedLocale(locale) && <Announcements key={locale} locale={locale} />}
      <header className="login-header">
        <div className="login-brand"><img src="/lifewood-logo.png" alt={t("app.providerName")} width="2285" height="492" /><strong translate="no">{t("app.clientName")}</strong></div>
        <Link className="login-language" to={`/${otherLocale}/${registering ? "register" : "login"}${location.hash}`} lang={otherLocale}>{locale === "zh-CN" ? "English" : "中文"}</Link>
      </header>
      <div className="login-columns">
        <LoginStory />
        <div className="login-form-side">
          <LoginBookBackdrop />
          <section className="login-panel" aria-labelledby="login-title">
        {status.isPending ? <div className="screen-status compact" role="status" aria-busy="true">{t("common.loading")}</div> : null}
        {status.isError ? <div className="inline-error" role="alert">{localizedApiError(status.error, t)} <button className="button button-secondary" type="button" onClick={() => void status.refetch()}>{t("common.retry")}</button></div> : null}
        {status.data ? (
          <>
            {registering ? <InvitationRegistrationPage /> : <>
            <div className="login-heading field-help-heading">
              <h1 id="login-title">{t(requiresBootstrap ? "auth.bootstrapTitle" : "auth.title")}</h1>
              {requiresBootstrap && <HelpPopover label={t("auth.bootstrapTitle")}>{t("auth.bootstrapDescription")}</HelpPopover>}
              {!requiresBootstrap && <Link className="login-mode-link" to={`/${locale}/register`}>{t("invitation.register")}<span aria-hidden="true"> →</span></Link>}
            </div>
            <form id="customer-login-form" className="login-form" onSubmit={submit} aria-busy={authenticate.isPending}>
              {requiresBootstrap ? <label className="login-field" htmlFor="display-name"><span>{t("auth.displayName")}</span><input id="display-name" name="displayName" type="text" autoComplete="name" minLength={2} maxLength={100} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
              {requiresBootstrap ? <label className="login-field" htmlFor="organization-name"><span>{t("auth.organizationName")}</span><input id="organization-name" name="organizationName" type="text" autoComplete="organization" minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></label> : null}
              {requiresBootstrap ? <label className="login-field" htmlFor="bootstrap-phone"><span>{t("auth.phone")}</span><input id="bootstrap-phone" name="phone" type="tel" autoComplete="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} /></label> : null}
              <label className="login-field" htmlFor="login-email"><span>{t("auth.email")}</span><input id="login-email" name="email" type="email" inputMode="email" autoComplete="username" spellCheck={false} maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <div className="login-field"><div className="field-help-heading"><label htmlFor="login-password">{t("auth.password")}</label>{requiresBootstrap && <HelpPopover label={t("auth.password")}>{t("auth.passwordHint")}</HelpPopover>}</div><span className="password-control"><input id="login-password" name="password" type={passwordVisible ? "text" : "password"} autoComplete={requiresBootstrap ? "new-password" : "current-password"} minLength={requiresBootstrap ? 8 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setPasswordVisible((visible) => !visible)}>{t(passwordVisible ? "auth.hidePassword" : "auth.showPassword")}</button></span></div>
              {requiresBootstrap ? <label className="login-field" htmlFor="confirm-password"><span>{t("auth.confirmPassword")}</span><input id="confirm-password" name="confirmPassword" type={passwordVisible ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} required aria-invalid={clientError ? true : undefined} aria-describedby={clientError ? "password-error" : undefined} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />{clientError ? <small className="field-error" id="password-error" role="alert">{clientError}</small> : null}</label> : null}
              {authenticate.isError ? <div className="inline-error" role="alert">{localizedApiError(authenticate.error, t)}</div> : null}
            </form>
            {!requiresBootstrap && <div className="login-account-actions"><label className="remember-control"><input name="rememberMe" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>{t("auth.rememberMe")}</span></label><ForgotPasswordButton /></div>}
            <button className="button button-primary login-submit" type="submit" form="customer-login-form" disabled={authenticate.isPending}>{authenticate.isPending ? t(requiresBootstrap ? "auth.creatingAccount" : "auth.signingIn") : t(requiresBootstrap ? "auth.createAccount" : "auth.signIn")}</button>
            {!requiresBootstrap && <OtherLoginMethods portal="customer" />}
            </>}
          </>
        ) : null}
      </section>
        </div>
      </div>
      <footer className="login-footer" role="contentinfo">
        <span translate="no">© {new Date().getFullYear()} {t("app.name")}</span>
        <nav aria-label={t("auth.footerLinks")}>
          <Link to={`/${locale}/help`}>{t("help.title")}</Link>
          <a href="https://lifewood.com/" target="_blank" rel="noopener noreferrer">{t("auth.officialWebsite")}<span aria-hidden="true">↗</span></a>
          <a href="https://lifewood.com/contact" target="_blank" rel="noopener noreferrer">{t("auth.contactUs")}<span aria-hidden="true">↗</span></a>
        </nav>
      </footer>
    </main>
  );
}
