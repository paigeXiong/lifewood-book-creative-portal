import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    base: mode === "production" ? "/admin/" : "/",
    plugins: [react()],
    server: {
      https: process.env.LIFEWOOD_DEV_SCHEME === "https" ? {
        cert: readFileSync(process.env.LIFEWOOD_DEV_TLS_CERT || ""),
        key: readFileSync(process.env.LIFEWOOD_DEV_TLS_KEY || ""),
      } : undefined,
      host: "127.0.0.1",
      port: Number(env.VITE_PORT || 5174),
      strictPort: true,
      proxy: {
      "/api": env.VITE_API_PROXY_TARGET || (mode === "e2e" ? "http://127.0.0.1:5090" : "http://127.0.0.1:5077"),
      },
    },
    build: { sourcemap: false },
  };
});
