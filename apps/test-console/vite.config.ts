import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  if (mode !== "development" && mode !== "test-console") {
    throw new Error("TEST-ONLY console: use the dedicated test-console build mode. Do not include this app in a production release.");
  }
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: { "/api": "http://127.0.0.1:5077" },
    },
    build: { sourcemap: false },
  };
});
