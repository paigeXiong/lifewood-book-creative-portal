import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppErrorBoundary } from "@lifewood/ui/error-boundary";
import "@lifewood/ui/tokens.css";
import "@lifewood/ui/avatar-editor.css";
import "@lifewood/ui/error-boundary.css";
import "@lifewood/i18n";
import { App } from "./App";
import "./styles.css";
import "./reference-ui.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
