import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoInAccountLocale, postAuthentication } from "./auth-request";
const headers = async (request: APIRequestContext) => ({ "X-CSRF-TOKEN": (await (await request.get("/api/auth/csrf")).json()).token });

test("organization member opens shared draft and creator profile without editing", async ({ page }) => {
  test.setTimeout(120000);
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {
    headers: await headers(page.request), data: status.requiresBootstrap
      ? { displayName: "E2E Owner", email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", organizationName: "E2E" }
      : { email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", rememberMe: false },
  });
  expect(auth.ok()).toBeTruthy();
  const owner = await (await page.request.get("/api/me")).json();
  const title = `Shared draft ${Date.now()}`;
  const created = await page.request.post("/api/projects", { headers: await headers(page.request), data: {} });
  expect(created.ok()).toBeTruthy(); const draft = await created.json();
  const saved = await page.request.put(`/api/projects/${draft.id}/draft`, { headers: await headers(page.request), data: { version: draft.version, project: { ...draft.project, projectName: title }, book: draft.book } });
  expect(saved.ok()).toBeTruthy();
  const email = `shared-${Date.now()}@lifewood.test`, password = "Shared-fixture-password-2026";
  const member = await page.request.post("/api/admin/users", { headers: await headers(page.request), data: { displayName: "Shared viewer", email, password, role: "customer", organizationId: owner.organization.id } });
  expect(member.ok()).toBeTruthy();
  expect((await postAuthentication(page.request, "/api/auth/login", { headers: await headers(page.request), data: { email, password, rememberMe: false } })).ok()).toBeTruthy();
  await page.route("**/api/announcements**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  for (const locale of ["zh-CN", "en-US"]) {
    await page.setViewportSize({ width: 1366, height: 900 });
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/tasks?q=${encodeURIComponent(title)}`);
    const row = page.locator(".task-project-row").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".task-copy, .task-delete")).toHaveCount(0);
    const returnPath = `/${locale}/tasks?${new URLSearchParams({ q: title })}`;
    await expect(row.locator(".task-identity")).toHaveAttribute("href", `/${locale}/tasks/${draft.id}?${new URLSearchParams({ returnTo: returnPath })}`);
    await row.locator(".task-identity").click();
    await expect(page.locator(".detail-back")).toHaveAttribute("href", returnPath);
    await page.reload();
    await page.locator(".detail-back").click();
    await expect(page).toHaveURL(url => url.pathname + url.search === returnPath);
    await expect(row).toHaveCount(1);
    await row.locator(".task-creator").click();
    await expect(page).toHaveURL(url => url.pathname === `/${locale}/organization/members/${owner.id}`);
    await expect(page.locator(".organization-member-back")).toHaveAttribute("href", `/${locale}/tasks?q=${encodeURIComponent(title).replaceAll("%20", "+")}`);
    await expect(page.getByRole("heading", { name: owner.displayName, exact: true })).toBeVisible();
    await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/project`);
    await expect(page).toHaveURL(new RegExp(`/tasks/${draft.id}$`));
    await expect(page.locator(".detail-header h1")).toHaveText(title);
    await expect(page.locator(".project-progress-state")).toContainText(locale === "zh-CN" ? "仅创建人" : "Only its creator");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:5193/${locale}/tasks?q=${encodeURIComponent(title)}`);
    await expect(row.locator(".task-creator")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `artifacts/shared-project-list-${locale}.png` });
  }
});
