import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { authService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";

export function LoginPage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [clientError, setClientError] = useState<string>();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: authService.getStatus, retry: false });
  const requiresBootstrap = status.data?.requiresBootstrap === true;
  const authenticate = useMutation({
    mutationFn: () => requiresBootstrap
      ? authService.bootstrap({ displayName, email, password })
      : authService.login({ email, password, rememberMe }),
    onSuccess: async (user) => {
      queryClient.setQueryData(["current-user"], user);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      const fallback = isSupportedLocale(locale) ? localizedPath(locale, "/tasks") : "/zh-CN/tasks";
      const target = (location.state as { from?: string } | null)?.from ?? fallback;
      navigate(target, { replace: true });
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
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-topline">
          <span translate="no">Lifewood AIGC Story Studio</span>
          <Link to={`/${otherLocale}/login`} lang={otherLocale}>{locale === "zh-CN" ? "English" : "中文"}</Link>
        </div>
        {status.isPending ? <div className="screen-status compact" role="status" aria-busy="true">{t("common.loading")}</div> : null}
        {status.isError ? <div className="inline-error" role="alert">{localizedApiError(status.error, t)} <button className="button button-secondary" type="button" onClick={() => void status.refetch()}>{t("common.retry")}</button></div> : null}
        {status.data ? (
          <>
            <div className="login-heading">
              <span className="folio-label">{requiresBootstrap ? t("auth.firstSetup") : t("auth.secureAccess")}</span>
              <h1 id="login-title">{t(requiresBootstrap ? "auth.bootstrapTitle" : "auth.title")}</h1>
              <p>{t(requiresBootstrap ? "auth.bootstrapDescription" : "auth.description")}</p>
            </div>
            <form className="login-form" onSubmit={submit} aria-busy={authenticate.isPending}>
              {requiresBootstrap ? <label className="login-field" htmlFor="display-name"><span>{t("auth.displayName")}</span><input id="display-name" name="displayName" type="text" autoComplete="name" minLength={2} maxLength={100} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
              <label className="login-field" htmlFor="login-email"><span>{t("auth.email")}</span><input id="login-email" name="email" type="email" inputMode="email" autoComplete="username" spellCheck={false} maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="login-field" htmlFor="login-password"><span>{t("auth.password")}</span><span className="password-control"><input id="login-password" name="password" type={passwordVisible ? "text" : "password"} autoComplete={requiresBootstrap ? "new-password" : "current-password"} minLength={requiresBootstrap ? 12 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setPasswordVisible((visible) => !visible)}>{t(passwordVisible ? "auth.hidePassword" : "auth.showPassword")}</button></span>{requiresBootstrap ? <small>{t("auth.passwordHint")}</small> : null}</label>
              {requiresBootstrap ? <label className="login-field" htmlFor="confirm-password"><span>{t("auth.confirmPassword")}</span><input id="confirm-password" name="confirmPassword" type={passwordVisible ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} required aria-invalid={clientError ? true : undefined} aria-describedby={clientError ? "password-error" : undefined} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />{clientError ? <small className="field-error" id="password-error" role="alert">{clientError}</small> : null}</label> : <label className="remember-control"><input name="rememberMe" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>{t("auth.rememberMe")}</span></label>}
              {authenticate.isError ? <div className="inline-error" role="alert">{localizedApiError(authenticate.error, t)}</div> : null}
              <button className="button button-primary login-submit" type="submit" disabled={authenticate.isPending}>{authenticate.isPending ? t(requiresBootstrap ? "auth.creatingAccount" : "auth.signingIn") : t(requiresBootstrap ? "auth.createAccount" : "auth.signIn")}</button>
            </form>
            <p className="login-security-note">{t("auth.securityNote")}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}