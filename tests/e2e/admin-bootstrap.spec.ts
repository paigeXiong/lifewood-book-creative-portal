import { expect, test } from "@playwright/test";

test("owner can initialize the platform and navigate the localized admin shell", async ({
  page, browser,
}) => {
  test.setTimeout(120_000);
  await page.goto("/zh-CN/overview");
  await expect(
    page.getByRole("heading", { name: "初始化平台管理员" }),
  ).toBeVisible();
  await page.getByLabel("姓名").fill("E2E Owner");
  await page.getByLabel("邮箱").fill("owner.e2e@lifewood.test");
  await page
    .getByLabel("密码", { exact: true })
    .fill("E2E-owner-password-2026");
  await page.getByLabel("确认密码").fill("E2E-owner-password-2026");
  await page.getByRole("button", { name: "创建所有者账号" }).click();

  await expect(page.getByRole("link", { name: "项目跟进" })).toBeVisible();
  await page.getByRole("link", { name: "用户管理" }).click();
  await expect(page).toHaveURL(/\/zh-CN\/users/);
  await expect(page.getByRole("button", { name: "创建用户" })).toBeVisible();

  await page.getByLabel("语言").selectOption("en-US");
  await expect(page).toHaveURL(/\/en-US\/users/);
  await expect(page.getByRole("button", { name: "Create user" })).toBeVisible();

  await test.step("admin saves and publishes a bilingual notice", async () => {
    await page.goto("/zh-CN/settings/announcements");
    await page.getByRole("button", { name: "新建公告", exact: true }).click();
    await page.getByRole("textbox", { name: "中文标题", exact: true }).fill("客户公告验收");
    await page.getByRole("textbox", { name: "中文正文", exact: true }).fill("仅用于独立测试环境。");
    await page.getByRole("textbox", { name: "英文标题", exact: true }).fill("Customer notice test");
    await page.getByRole("textbox", { name: "英文正文", exact: true }).fill("Isolated test environment only.");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await page.getByRole("button", { name: "确认继续", exact: true }).click();
    await expect(page.getByRole("cell", { name: "已发布", exact: true })).toBeVisible();
  });

  const csrf = (await (await page.request.get("/api/auth/csrf")).json()).token;
  const publish = async (index: number, placement = "personal") => {
    const id = (await import("node:crypto")).randomUUID().replaceAll("-", "");
    const saved = await page.request.put(`/api/admin/announcements/${id}`, {
      headers: { "X-CSRF-TOKEN": csrf }, data: { titleZh: `历史公告 ${index}`, bodyZh: "测试正文", titleEn: `Notice ${index}`, bodyEn: "Test body", placement, audience: placement === "login" ? "specified" : "all", languages: placement === "login" ? ["zh-CN"] : [], organizationIds: [], startsAt: null, endsAt: null, version: 0 },
    });
    expect(saved.ok()).toBeTruthy();
    const result = await page.request.post(`/api/admin/announcements/${id}/publish`, { headers: { "X-CSRF-TOKEN": csrf }, data: { version: (await saved.json()).version } });
    expect(result.ok()).toBeTruthy();
  };
  for (let index = 0; index < 22; index++) await publish(index);
  await publish(99, "login");

  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await customerContext.newPage();
  try {
    await test.step("public notices respect language and reappear on a new login visit", async () => {
      await customer.goto("http://127.0.0.1:5193/en-US/login");
      await expect(customer.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
      await expect(customer.getByRole("dialog")).toHaveCount(0);
      await customer.goto("http://127.0.0.1:5193/zh-CN/login");
      await expect(customer.getByRole("dialog")).toBeVisible();
      await expect(customer.getByRole("heading", { name: "历史公告 99", exact: true })).toBeVisible();
      await customer.locator("dialog header button").click();
      await expect(customer.getByRole("dialog")).toHaveCount(0);
      await customer.reload();
      await expect(customer.getByRole("dialog")).toBeVisible();
      await customer.locator("dialog header button").click();
    });
    await test.step("personal history loads more and dismissed notices stay closed", async () => {
      await customer.getByRole("textbox", { name: "邮箱", exact: true }).fill("owner.e2e@lifewood.test");
      await customer.locator("#login-password").fill("E2E-owner-password-2026");
      await customer.getByRole("button", { name: "登录", exact: true }).click();
      await expect(customer).toHaveURL(/\/tasks$/);
      const modal = customer.locator("dialog.customer-announcements");
      await expect(modal).toBeVisible();
      await modal.locator("footer").scrollIntoViewIfNeeded();
      await expect(modal.locator("article")).toHaveCount(23);
      await expect(modal.getByRole("heading", { name: "客户公告验收", exact: true })).toHaveCount(1);
      await modal.screenshot({ path: "artifacts/announcement-mobile-e2e.png" });
      await modal.locator("header button").click();
      await expect(customer.getByRole("dialog")).toHaveCount(0);
      await customer.reload();
      await expect(customer.getByRole("button", { name: "查看历史公告", exact: true })).toBeVisible();
      await expect(customer.getByRole("dialog")).toHaveCount(0);
      await customer.getByRole("button", { name: "查看历史公告", exact: true }).click();
      await expect(modal).toBeVisible();
      await modal.locator("footer").scrollIntoViewIfNeeded();
      await expect(modal.locator("article")).toHaveCount(23);
    });
  } finally { await customerContext.close().catch(() => {}); }

});
