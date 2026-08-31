import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppErrorBoundary } from "@lifewood/ui/error-boundary";
import "@lifewood/ui/tokens.css";
import "@lifewood/ui/error-boundary.css";
import "@lifewood/i18n";
import "./i18n";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } } });

function RootErrorBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return <AppErrorBoundary labels={{ title: t("common.fatalErrorTitle"), description: t("common.fatalErrorDescription"), reload: t("common.reloadPage") }}>{children}</AppErrorBoundary>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter><App /></BrowserRouter>
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
