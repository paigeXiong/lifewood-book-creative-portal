import { expect, test } from "@playwright/test";
import { gotoInAccountLocale, postAuthentication } from "./auth-request";

test("notification filters and loaded pages survive browser navigation in both portals and languages", async ({ page }) => {
  test.setTimeout(120000);
  const token = (await (await page.request.get("/api/auth/csrf")).json()).token;
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {
    headers: { "X-CSRF-TOKEN": token }, data: status.requiresBootstrap
      ? { displayName: "E2E Owner", email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", organizationName: "E2E" }
      : { email: "owner.e2e@lifewood.test", password: "E2E-owner-password-2026", rememberMe: false },
  });
  expect(auth.ok()).toBeTruthy();
  await page.route("**/api/notifications/stream*", route => route.abort());
  await page.route("**/api/notifications/state", route => route.fulfill({ status: 204 }));
  await page.route(/\/api\/notifications(?:\?|$)/, route => {
    const second = new URL(route.request().url()).searchParams.has("before");
    return route.fulfill({ json: { items: Array.from({ length: 30 }, (_, index) => ({
      id: (second ? 30 : 60) - index, kind: "workflow", projectId: "book", projectTitle: "Book", actor: "Editor", createdAt: "2026-09-16T00:00:00Z", read: false, archived: false, state: "info", targetId: "", title: `Book ${(second ? 30 : 60) - index}`, level: "normal",
    })), nextCursor: second ? null : 31, unread: 60, watermark: 60 } });
  });
  for (const port of [5193, 5194]) for (const locale of ["zh-CN", "en-US"]) {
    const base = `http://127.0.0.1:${port}/${locale}`;
    await page.route("**/api/notifications/*/target?*", route => route.fulfill({ json: { path: `/${locale}/overview` } }));
    await gotoInAccountLocale(page, `${base}/notifications`);
    const center = page.locator(".notification-center.content"), rows = center.locator(".notification-list > li"), search = center.locator('input[type="search"]');
    await expect(rows).toHaveCount(30, { timeout: 15000 });
    const archived = center.getByRole("checkbox", { name: locale === "zh-CN" ? "已归档" : "Archived", exact: true });
    await archived.click(); await expect(archived).toBeChecked();
    await expect(page).toHaveURL(`${base}/notifications?archived=true`);
    await page.reload(); await expect(archived).toBeChecked();
    await archived.click(); await expect(archived).not.toBeChecked();
    await expect(page).toHaveURL(`${base}/notifications`);
    await search.fill("Book"); await expect(page).toHaveURL(`${base}/notifications?q=Book`);
    await center.getByRole("button", { name: locale === "zh-CN" ? "加载更多" : "Load more", exact: true }).click();
    await expect(page).toHaveURL(`${base}/notifications?q=Book&pages=2`); await expect(rows).toHaveCount(60);
    await page.goBack(); await expect(rows).toHaveCount(30);
    await page.goForward(); await expect(rows).toHaveCount(60);
    await page.reload(); await expect(rows).toHaveCount(60); await expect(search).toHaveValue("Book");
    await center.locator('.notification-row-actions button[data-icon-motion="press"]').nth(1).click();
    await expect(page).toHaveURL(`${base}/overview`);
    await page.goBack(); await expect(rows).toHaveCount(60); await expect(search).toHaveValue("Book");
    await page.locator(".notification-bell").click();
    const compact = page.locator(".notification-center.compact");
    await expect(compact.locator('input[type="search"]')).toHaveValue("");
    await compact.locator('input[type="search"]').fill("compact");
    await expect(compact.locator(".notification-list > li")).toHaveCount(30);
    await expect(page).toHaveURL(`${base}/notifications?q=Book&pages=2`);
    await compact.locator(".notification-navigation-actions button").last().click();
    await expect(page).toHaveURL(`${base}/notifications?q=compact`); await expect(search).toHaveValue("compact"); await expect(rows).toHaveCount(30);
    await expect(page.locator(".notification-quick-dialog")).not.toBeVisible();
    await page.unroute("**/api/notifications/*/target?*");
  }
});
