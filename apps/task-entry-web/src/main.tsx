import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppErrorBoundary } from "@lifewood/ui/error-boundary";
import "@lifewood/ui/tokens.css";
import "@lifewood/ui/avatar-editor.css";
import "@lifewood/ui/error-boundary.css";
import "@lifewood/i18n";
import { appRoutes, ScreenLoading, RouteError } from "./App";
import "./styles.css";
import "./reference-ui.css";
import "./wizard-motion.css";
import "./client-experience.css";
import { wizardDirection } from "./wizard-motion";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function RootErrorBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return <AppErrorBoundary labels={{ title: t("common.fatalErrorTitle"), description: t("common.fatalErrorDescription"), reload: t("common.reloadPage") }}>{children}</AppErrorBoundary>;
}

const router = createBrowserRouter([{
  element: <Outlet />,
  hydrateFallbackElement: <ScreenLoading />,
  errorElement: <RouteError />,
  children: appRoutes,
}]);
let previousPath = router.state.location.pathname;
router.subscribe(state => {
  const nextPath = state.navigation.location?.pathname ?? state.location.pathname;
  const direction = wizardDirection(previousPath, nextPath);
  if (direction) document.documentElement.dataset.wizardDirection = direction;
  else if (nextPath !== previousPath) delete document.documentElement.dataset.wizardDirection;
  if (state.navigation.state === "idle") previousPath = state.location.pathname;
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
