import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "@lifewood/ui/tokens.css";
import "@lifewood/ui/avatar-editor.css";
import "@lifewood/i18n";
import "./i18n";
import { App } from "./App";
import "./styles.css";
import "./surface-theme.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } } });
const router = createBrowserRouter([{ path: "*", element: <App /> }], { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || undefined });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
