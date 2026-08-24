import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __LOCAL_AUTH__: JSON.stringify(mode === "development"),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:5077",
    },
  },
  build: {
    sourcemap: mode !== "production",
  },
  test: {
    environment: "jsdom",
  },
}));
