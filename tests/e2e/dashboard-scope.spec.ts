import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoInAccountLocale, postAuthentication } from "./auth-request";
const headers = async (request: APIRequestContext) => ({ "X-CSRF-TOKEN": (await (await request.get("/api/auth/csrf")).json()).token });
test("dashboard scope persists and drilldown preserves scope in both languages", async ({page}) => {
  test.setTimeout(90000);
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {
    headers: await headers(page.request), data: status.requiresBootstrap
      ? { displayName: "E2E Owner", email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", organizationName: "E2E" }
      : { email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", rememberMe: false },
  });
  expect(auth.ok()).toBeTruthy();
  await page.route("**/api/announcements**", route => route.fulfill({ json: { items: [], nextCursor: null } }));

  for (const locale of ["zh-CN", "en-US"]) {
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/overview`);
    await expect(page.locator('.dashboard-scope button').first()).toHaveAttribute('aria-pressed', 'true');
    const response = page.waitForResponse(r => r.url().includes('/projects/dashboard?') && new URL(r.url()).searchParams.get('scope') === 'organization');
    await page.locator('.dashboard-scope button').nth(1).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.locator('.dashboard-scope button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('.dashboard-scope button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.metric-total a').click();
    await expect(page).toHaveURL(new RegExp('/tasks\\?scope=organization'));
    await page.goto(`http://127.0.0.1:5193/${locale}/overview?scope=personal`);
    await page.locator('.metric-total a').click();
    await expect(page).toHaveURL(new RegExp('/tasks\\?scope=personal'));
  }
});
