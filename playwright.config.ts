import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5194",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command:
        "powershell -NoProfile -Command \"$env:ASPNETCORE_URLS='http://127.0.0.1:5090'; $env:ASPNETCORE_ENVIRONMENT='Development'; $env:Lifewood__DataDirectory='../../artifacts/e2e-data'; $env:Lifewood__RequireWebAssets='false'; dotnet run --project services/platform-api/Lifewood.PlatformApi.csproj -c Release --no-build --no-launch-profile\"",
      url: "http://127.0.0.1:5090/api/health",
      timeout: 120_000,
    },
    {
      command:
        "npm run dev --workspace @lifewood/task-entry-web -- --host 127.0.0.1 --port 5193 --mode e2e",
      url: "http://127.0.0.1:5193/zh-CN/login",
      timeout: 120_000,
    },
    {
      command:
        "npm run dev --workspace @lifewood/admin-web -- --host 127.0.0.1 --port 5194 --mode e2e",
      url: "http://127.0.0.1:5194/zh-CN/overview",
      timeout: 120_000,
    },
  ],
});
