import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    plugins: [react()],

    server: {
      https: process.env.LIFEWOOD_DEV_SCHEME === "https" ? {
        cert: readFileSync(process.env.LIFEWOOD_DEV_TLS_CERT || ""),
        key: readFileSync(process.env.LIFEWOOD_DEV_TLS_KEY || ""),
      } : undefined,
    port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      proxy: {
      "/api": env.VITE_API_PROXY_TARGET || (mode === "e2e" ? "http://127.0.0.1:5090" : "http://localhost:5077"),
      },
    },
    build: {
      sourcemap: mode !== "production",
      manifest: true,
      rollupOptions: { output: { manualChunks: id => /\/node_modules\/(?:react(?:-dom|-router(?:-dom)?|-i18next)?|scheduler|i18next|@tanstack\/(?:query-core|react-query)|@remix-run\/router)\//.test(id.replaceAll("\\\\", "/")) ? "vendor" : undefined } },
    },
    test: {
      environment: "jsdom",
    },
  };
});
