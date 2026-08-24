import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authService, ApiError, localizedApiError } from "@lifewood/api-client";
import { i18n, isSupportedLocale, localizedPath, setLocale } from "@lifewood/i18n";
import type { SupportedLocale } from "@lifewood/domain";
import { AppShell } from "./components/AppShell";
const LocalLoginPage = __LOCAL_AUTH__
  ? lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })))
  : null;
const VoiceAndReferencesPage = lazy(() => import("./pages/VoiceAndReferencesPage").then((module) => ({ default: module.VoiceAndReferencesPage })));
const TaskListPage = lazy(() => import("./pages/TaskListPage").then((module) => ({ default: module.TaskListPage })));
const ProjectFormPage = lazy(() => import("./pages/ProjectFormPage").then((module) => ({ default: module.ProjectFormPage })));
const CreativeFormPage = lazy(() => import("./pages/CreativeFormPage").then((module) => ({ default: module.CreativeFormPage })));
const UpcomingStepPage = lazy(() => import("./pages/UpcomingStepPage").then((module) => ({ default: module.UpcomingStepPage })));
const TaskDetailPage = lazy(() => import("./pages/TaskDetailPage").then((module) => ({ default: module.TaskDetailPage })));
const SubmissionSuccessPage = lazy(() => import("./pages/SubmissionSuccessPage").then((module) => ({ default: module.SubmissionSuccessPage })));

function ScreenLoading() {
  const { t } = useTranslation();
  return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
}

function LoginRoute() {
  const location = useLocation();
  const { t } = useTranslation();
  const loginUrl = import.meta.env.VITE_EXTERNAL_LOGIN_URL as string | undefined;
  useEffect(() => {
    if (!LocalLoginPage && loginUrl) {
      const returnUrl = `${window.location.origin}${location.pathname.replace(/\/login$/, "/tasks")}`;
      window.location.replace(`${loginUrl}?returnUrl=${encodeURIComponent(returnUrl)}`);
    }
  }, [location.pathname, loginUrl]);
  if (LocalLoginPage) {
    return <Suspense fallback={<ScreenLoading />}><LocalLoginPage /></Suspense>;
  }
  if (loginUrl) return <ScreenLoading />;
  return <div className="screen-status" role="alert">{t("auth.externalMissing")}</div>;
}

function RootRedirect() {
  const stored = window.localStorage.getItem("lw.locale") ?? undefined;
  const locale: SupportedLocale = isSupportedLocale(stored)
    ? stored
    : navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return <Navigate replace to={localizedPath(locale, "/tasks")} />;
}

function LocaleLayout() {
  const { locale } = useParams();
  useEffect(() => {
    if (isSupportedLocale(locale)) {
      window.localStorage.setItem("lw.locale", locale);
      void setLocale(locale).then(() => { document.title = i18n.t("app.name"); });
    }
  }, [locale]);

  if (!isSupportedLocale(locale)) return <Navigate replace to="/zh-CN/tasks" />;
  return <Outlet context={{ locale }} />;
}

function ProtectedLayout() {
  const { locale } = useParams();
  const location = useLocation();
  const { t } = useTranslation();
  const userQuery = useQuery({ queryKey: ["current-user"], queryFn: authService.getCurrentUser, retry: false });

  if (!isSupportedLocale(locale)) return null;
  if (userQuery.isPending) return <ScreenLoading />;
  if (userQuery.error instanceof ApiError && userQuery.error.details.code === "auth.unauthorized") {
    return <Navigate replace state={{ from: location.pathname }} to={localizedPath(locale, "/login")} />;
  }
  if (userQuery.isError || !userQuery.data) {
    return <div className="screen-status" role="alert">{localizedApiError(userQuery.error, t)}</div>;
  }

  return <AppShell user={userQuery.data}><Suspense fallback={<ScreenLoading />}><Outlet context={{ locale, user: userQuery.data }} /></Suspense></AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/:locale" element={<LocaleLayout />}>
        <Route path="login" element={<LoginRoute />} />
        <Route element={<ProtectedLayout />}>
          <Route path="tasks" element={<TaskListPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="tasks/:taskId/submitted" element={<SubmissionSuccessPage />} />
          <Route path="tasks/:taskId/edit/project" element={<ProjectFormPage />} />
          <Route path="tasks/:taskId/edit/characters" element={<CreativeFormPage />} />
          <Route path="tasks/:taskId/edit/voice" element={<VoiceAndReferencesPage />} />
          <Route path="tasks/:taskId/edit/review" element={<UpcomingStepPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
