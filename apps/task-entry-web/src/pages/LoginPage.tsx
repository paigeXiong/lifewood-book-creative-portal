import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { localAuthService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";

export function LoginPage() {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["test-users"], queryFn: localAuthService.listUsers });
  const login = useMutation({
    mutationFn: localAuthService.login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["current-user"] });
      const fallback = isSupportedLocale(locale) ? localizedPath(locale, "/tasks") : "/zh-CN/tasks";
      const target = (location.state as { from?: string } | null)?.from ?? fallback;
      navigate(target, { replace: true });
    },
  });

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="folio-kicker">{t("app.testEnvironment")}</div>
        <h1>{t("auth.title")}</h1>
        <p>{t("auth.description")}</p>
        <div className="identity-list" aria-busy={users.isPending}>
          {users.isPending && <div className="screen-status compact" role="status">{t("common.loading")}</div>}
          {!users.isPending && users.data?.length === 0 && <div className="inline-error" role="status">{t("auth.noUsers")}</div>}
          {users.data?.map((user) => (
            <button key={user.id} type="button" className="identity-card" disabled={login.isPending} onClick={() => login.mutate(user.id)}>
              <span className="avatar avatar-large" aria-hidden="true">{user.displayName.slice(0, 2)}</span>
              <span><strong>{user.displayName}</strong><small>{user.organization?.name}</small></span>
              <span className="identity-action">{login.isPending ? t("auth.signingIn") : t("auth.continueAs", { name: user.displayName })}</span>
            </button>
          ))}
        </div>
        {(users.isError || login.isError) && <div className="inline-error" role="alert">{localizedApiError(users.error ?? login.error, t)}</div>}
      </section>
    </main>
  );
}
