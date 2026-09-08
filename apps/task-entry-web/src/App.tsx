import {NotificationCenter} from "@lifewood/ui/notifications";
import { RevisionWorkspace } from "./components/RevisionWorkspace";
import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, Route, createRoutesFromElements, useLocation, useParams, useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authService, ApiError } from "@lifewood/api-client";
import { i18n, isSupportedLocale, localizedPath, setLocale } from "@lifewood/i18n";
import type { SupportedLocale } from "@lifewood/domain";
import { AppShell } from "./components/AppShell";
import { ScreenError } from "./components/ScreenError";
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const TaskListPage = lazy(() => import("./pages/TaskListPage").then((module) => ({ default: module.TaskListPage })));
const TaskDetailPage = lazy(() => import("./pages/TaskDetailPage").then((module) => ({ default: module.TaskDetailPage })));
const SubmissionSuccessPage = lazy(() => import("./pages/SubmissionSuccessPage").then((module) => ({ default: module.SubmissionSuccessPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));

export function ScreenLoading() {
  const { t } = useTranslation();
  return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
}

function LoginRoute() {
  return <Suspense fallback={<ScreenLoading />}><LoginPage /></Suspense>;
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
  const userQuery = useQuery({ queryKey: ["current-user"], queryFn: authService.getCurrentUser, retry: false });

  if (!isSupportedLocale(locale)) return null;
  if (userQuery.isPending) return <ScreenLoading />;
  if (userQuery.error instanceof ApiError && userQuery.error.details.code === "auth.unauthorized") {
    return <Navigate replace state={{ from: location.pathname }} to={localizedPath(locale, "/login")} />;
  }
  if (userQuery.isError || !userQuery.data) {
    return <ScreenError error={userQuery.error} onRetry={() => userQuery.refetch()} />;
  }

  return <AppShell user={userQuery.data}><Suspense fallback={<ScreenLoading />}><RevisionWorkspace><Outlet context={{ locale, user: userQuery.data }} /></RevisionWorkspace></Suspense></AppShell>;
}

export const appRoutes = createRoutesFromElements(<>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/:locale" element={<LocaleLayout />}>
        <Route path="login" element={<LoginRoute />} />
        <Route element={<ProtectedLayout />}>
          <Route path="notifications" element={<NotificationCenter/>}/>
          <Route path="tasks" element={<TaskListPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="tasks/:taskId/submitted" element={<SubmissionSuccessPage />} />
          <Route path="tasks/:taskId/edit/project" lazy={async () => ({ Component: (await import("./pages/ProjectFormPage")).ProjectFormPage })} />
          <Route path="tasks/:taskId/edit/characters" lazy={async () => { const { CreativeFormPage } = await import("./pages/CreativeFormPage"); return { Component: () => <CreativeFormPage stage="characters" /> }; }} />
          <Route path="tasks/:taskId/edit/style" lazy={async () => { const { CreativeFormPage } = await import("./pages/CreativeFormPage"); return { Component: () => <CreativeFormPage stage="style" /> }; }} />
          <Route path="tasks/:taskId/edit/voice" lazy={async () => { const { VoiceAndReferencesPage } = await import("./pages/VoiceAndReferencesPage"); return { Component: () => <VoiceAndReferencesPage stage="voice" /> }; }} />
          <Route path="tasks/:taskId/edit/references" lazy={async () => { const { VoiceAndReferencesPage } = await import("./pages/VoiceAndReferencesPage"); return { Component: () => <VoiceAndReferencesPage stage="references" /> }; }} />
          <Route path="tasks/:taskId/edit/review" lazy={async () => ({ Component: (await import("./pages/UpcomingStepPage")).UpcomingStepPage })} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
</>);

export function RouteError() {
  return <ScreenError error={useRouteError()} onRetry={() => window.location.reload()} />;
}
