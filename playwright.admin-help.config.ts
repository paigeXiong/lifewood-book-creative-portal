import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/admin-help", testMatch: "help.spec.ts", workers: 1, timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5294", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { command: "npx vite --config tests/admin-help/vite.config.ts", url: "http://127.0.0.1:5294", timeout: 60_000 },
});
