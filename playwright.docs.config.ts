import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Each capture starts with a new empty database; never reuse development data.
const data = `../../artifacts/docs-demo-${Date.now()}`;
const servers = base.webServer as { command: string; url: string; timeout: number }[];
export default defineConfig({ ...base, testDir: "tests/demo", retries: 0, timeout: 120000,
  webServer: servers.map((server, index) => index === 0 ? {
    ...server,
    command: server.command.replace("../../artifacts/e2e-data", data).replace("$env:ASPNETCORE_URLS", "$env:Lifewood__Mail__Enabled='false'; $env:ASPNETCORE_URLS"),
  } : server),
});
