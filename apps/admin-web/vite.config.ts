import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    base: mode === "production" ? "/admin/" : "/",
    plugins: [react()],
    server: {
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
