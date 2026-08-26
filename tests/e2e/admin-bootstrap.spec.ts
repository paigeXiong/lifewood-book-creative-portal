import { expect, test } from "@playwright/test";

test("owner can initialize the platform and navigate the localized admin shell", async ({
  page,
}) => {
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
});
