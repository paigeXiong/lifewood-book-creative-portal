import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoInAccountLocale, postAuthentication } from "./auth-request";
const headers = async (request: APIRequestContext) => ({ "X-CSRF-TOKEN": (await (await request.get("/api/auth/csrf")).json()).token });

test("guests can open customer help from login but cannot read admin guides", async ({ page }) => {
  await page.route("**/api/announcements**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  for (const locale of ["zh-CN", "en-US"]) {
    await page.goto(`http://127.0.0.1:5193/${locale}/login`);
    await page.getByRole("link", { name: locale === "zh-CN" ? "帮助中心" : "Help center", exact: true }).click();
    await expect(page.locator(".help-card")).toHaveCount(12);
    await expect(page.locator(".help-audiences")).toHaveCount(0);
    await page.locator(".help-search input").fill(locale === "zh-CN" ? "未验证邮箱" : "unverified");
    await page.locator('.help-search button[type="submit"]').click();
    await expect(page.locator('.help-card[href*="article=password"]')).toBeVisible();
    await page.goto(`http://127.0.0.1:5193/${locale}/help?article=start`);
    await expect.poll(() => page.locator(".help-screenshot img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".help-article h1")).toBeVisible();
    await expect(page.locator('.public-help-header a[href$="/login"]')).toBeVisible();
    expect((await page.request.get(`/api/help?audience=admin&locale=${locale}`)).status()).toBe(401);
    expect((await page.request.get(`/api/help/images/admin-overview?locale=${locale}`)).status()).toBe(404);
    await page.goto(`http://127.0.0.1:5193/${locale}/help?audience=admin`);
    await expect(page.locator(".help-center [role=alert]")).toBeVisible();
    await expect(page.locator(".help-card")).toHaveCount(0);
  }
});

test("help audiences, full-text search, linked articles and screenshots work in both languages", async ({ page }) => {
  test.setTimeout(120000);
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {
    headers: await headers(page.request), data: status.requiresBootstrap
      ? { displayName: "E2E Owner", email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", organizationName: "E2E" }
      : { email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", rememberMe: false },
  });
  expect(auth.ok()).toBeTruthy();
  await page.route("**/api/announcements**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  for (const locale of ["zh-CN", "en-US"]) {
    await page.setViewportSize({ width: 1366, height: 900 });
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/help`);
    await expect(page.locator(".help-card")).toHaveCount(12);
    let releaseSwitch!: () => void;
    const switchGate = new Promise<void>(resolve => { releaseSwitch = resolve; });
    const delayedHelp = async (route: import("@playwright/test").Route) => {
      if (new URL(route.request().url()).searchParams.get("audience") === "admin") await switchGate;
      await route.continue();
    };
    await page.route("**/api/help?*", delayedHelp);
    try {
      await page.locator(".help-audiences button").nth(1).click();
      await expect(page.locator(".help-results")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".help-results")).toHaveAttribute("inert", "");
      await expect(page.locator(".help-card")).toHaveCount(12);
    } finally { releaseSwitch(); }
    await expect(page.locator(".help-card")).toHaveCount(14);
    await expect(page.locator(".help-results")).not.toHaveAttribute("inert", "");
    await page.unroute("**/api/help?*", delayedHelp);

    await gotoInAccountLocale(page, `http://127.0.0.1:5194/${locale}/help?audience=admin`);
    await expect(page.locator(".help-card")).toHaveCount(14);
    await page.locator(".function-search-trigger").click();
    await page.locator(".function-search-dialog input").fill(locale === "zh-CN" ? "注册" : "registration");
    await expect(page.locator(`.function-search-results a[href="/${locale}/users"]`)).toBeVisible();
    await expect(page.locator(`.function-search-results a[href="/${locale}/settings/oidc"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".function-search-dialog")).not.toBeVisible();
    await expect(page.locator(".function-search-trigger")).toBeFocused();
    await expect(page.locator(".help-center")).toHaveCSS("overflow-y", "auto");
    await page.locator('.help-card[href*="article=backups"]').click();
    await expect(page.locator(".help-article h1")).toContainText(locale === "zh-CN" ? "备份" : "Backups");
    await page.locator(".help-search input").fill("STARTTLS");
    await page.locator(".help-search button[type=submit]").click();
    await expect(page.locator(".help-card")).toHaveCount(2);
    await page.locator('.help-card[href*="article=mail-service"]').click();
    await expect(page.locator(".help-article h1")).toContainText(locale === "zh-CN" ? "配置邮件" : "Configuring email");
    await page.reload();
    await expect(page.locator(".help-article li")).toHaveCount(4);
    await page.locator(".help-article summary").first().click();
    await expect(page.locator(".help-article details[open]")).toHaveCount(1);
    await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/help?article=intake`);
    await expect(page.locator(".help-screenshot img")).toBeVisible();
    await expect.poll(() => page.locator(".help-screenshot img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await page.locator(".help-screenshot").click();
    await expect(page.locator(".help-image-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".help-image-dialog")).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `artifacts/help-article-${locale}.png` });
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({tag:e.tagName, cls:e.className, right:e.getBoundingClientRect().right})));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: JSON.stringify(overflow) }).toBeTruthy();
    await page.goto(`http://127.0.0.1:5193/${locale}/help?q=unmatched-zzzz`);
    await expect(page.locator(".help-empty")).toBeVisible();
    await page.locator(".help-empty button").click();
    await expect(page.locator(".help-card")).toHaveCount(12);
  }
  const owner = await (await page.request.get("/api/me")).json();
  const email = `help-${Date.now()}@lifewood.test`, password = "Help-fixture-password-2026";
  expect((await page.request.post("/api/admin/users", { headers: await headers(page.request), data: { displayName: "Help reader", email, password, role: "customer", organizationId: owner.organization.id } })).ok()).toBeTruthy();
  expect((await postAuthentication(page.request, "/api/auth/login", { headers: await headers(page.request), data: { email, password, rememberMe: false } })).ok()).toBeTruthy();
  await gotoInAccountLocale(page, "http://127.0.0.1:5193/en-US/help?audience=admin");
  await expect(page.getByRole("alert")).toContainText("cannot access administrator");
  await expect(page.locator(".help-audiences")).toHaveCount(0);
  expect((await page.request.get("/api/help?audience=admin")).status()).toBe(403);
  expect((await page.request.get("/api/help/images/admin-overview")).status()).toBe(404);
});
