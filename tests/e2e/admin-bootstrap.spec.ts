import { expect, test } from "@playwright/test";

test("owner can initialize the platform and navigate the localized admin shell", async ({
  page, browser,
}) => {
  test.setTimeout(300_000);
  const startedAt = Date.now();
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

  await test.step("admin saves and publishes single-content notice", async () => {
    await page.goto("/zh-CN/settings/announcements");
    await page.getByRole("button", { name: "新建公告", exact: true }).click();
    await page.getByRole("textbox", { name: "标题", exact: true }).fill("客户公告验收");
    await page.getByRole("textbox", { name: "正文", exact: true }).fill("仅用于独立测试环境。");
    await expect(page.getByRole("spinbutton", { name: "公示天数", exact: true })).toHaveValue("30");
    await page.getByRole("spinbutton", { name: "公示天数", exact: true }).fill("1");
    await expect(page.locator("input[type=datetime-local]")).toHaveCount(0);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("预计发送给 1 个账号");
    await page.getByRole("button", { name: "确认继续", exact: true }).click();
    await expect(page.getByRole("cell", { name: "已发布", exact: true })).toBeVisible();
  });

  await test.step("announcement filters and draft-only deletion", async () => {
    await page.getByRole("combobox",{name:"状态",exact:true}).selectOption("draft");
    await expect(page.getByText("暂无公告",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"新建公告",exact:true}).click();
    for(const [label,value] of [["标题","待删除草稿"],["正文","测试草稿"]]) await page.getByRole("textbox",{name:label,exact:true}).fill(value);
    await page.getByRole("button",{name:"保存草稿",exact:true}).click();
    await expect(page.getByRole("button",{name:"删除草稿",exact:true})).toBeVisible();
    await page.getByRole("combobox",{name:"展示位置",exact:true}).selectOption("login");
    await expect(page.getByText("暂无公告",{exact:true})).toBeVisible();
    await page.getByRole("combobox",{name:"展示位置",exact:true}).selectOption("personal");
    await page.getByRole("button",{name:"删除草稿",exact:true}).click();
    await page.getByRole("button",{name:"确认继续",exact:true}).click();
    await expect(page.getByText("暂无公告",{exact:true})).toBeVisible();
    await page.getByRole("combobox",{name:"状态",exact:true}).selectOption("published");
    await expect(page.getByRole("cell",{name:"已发布",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"删除草稿",exact:true})).toHaveCount(0);
  });

  await test.step("English editor keeps one content version and supports optional targeting", async () => {
    await page.goto("/en-US/settings/announcements");
    await expect(page.getByRole("cell", { name: "Published", exact: true })).toBeVisible();
    await expect(page.getByText("客户公告验收", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New announcement", exact: true }).click();
    const editor = page.getByRole("dialog");
    await expect(editor.locator(".notice-copy-fields").getByRole("textbox")).toHaveCount(2);
    await editor.getByRole("spinbutton", { name: "Display duration (days)", exact: true }).fill("60");
    await editor.getByRole("textbox", { name: "Title", exact: true }).fill("Single content draft");
    await editor.getByRole("textbox", { name: "Body", exact: true }).fill("无需同时填写翻译。 No forced split.");
    await editor.getByRole("combobox", { name: "Audience", exact: true }).selectOption("specified");
    await editor.getByRole("checkbox", { name: "English", exact: true }).check();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await editor.screenshot({ path: "artifacts/announcement-editor-mobile-en.png" });
    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/zh-CN/settings/announcements");
    const row = page.getByRole("row").filter({ hasText: "Single content draft" });
    await row.getByRole("button", { name: "编辑草稿", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "正文", exact: true })).toHaveValue("无需同时填写翻译。 No forced split.");
    await expect(page.getByRole("spinbutton", { name: "公示天数", exact: true })).toHaveValue("60");
    await expect(page.getByRole("checkbox", { name: "English", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await row.getByRole("button", { name: "删除草稿", exact: true }).click();
    await page.getByRole("button", { name: "确认继续", exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  await test.step("legacy drafts preserve translations until their content is edited", async () => {
    const token = (await (await page.request.get("/api/auth/csrf")).json()).token;
    const id = (await import("node:crypto")).randomUUID().replaceAll("-", "");
    const saved = await page.request.put(`/api/admin/announcements/${id}`, {
      headers: { "X-CSRF-TOKEN": token }, data: { titleZh: "旧版草稿", bodyZh: "原中文", titleEn: "Legacy draft", bodyEn: "Original English", placement: "personal", audience: "all", languages: [], organizationIds: [], startsAt: null, endsAt: null, version: 0 },
    });
    expect(saved.ok()).toBeTruthy();
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: "旧版草稿" });
    await row.getByRole("button", { name: "编辑草稿", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "正文", exact: true })).toHaveValue("原中文");
    await page.getByRole("combobox", { name: "发布范围", exact: true }).selectOption("specified");
    await page.getByRole("checkbox", { name: "English", exact: true }).check();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const list = await (await page.request.get("/api/admin/announcements")).json();
    const content = list.items.find((d: { id: string }) => d.id === id).content;
    expect(content.title ?? null).toBeNull();
    expect(content.bodyZh).toBe("原中文");
    expect(content.bodyEn).toBe("Original English");
    await row.getByRole("button", { name: "编辑草稿", exact: true }).click();
    await page.getByRole("textbox", { name: "正文", exact: true }).fill("改为单份正文");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const updated = await (await page.request.get("/api/admin/announcements")).json();
    expect(updated.items.find((d: { id: string }) => d.id === id).content.body).toBe("改为单份正文");
    await row.getByRole("button", { name: "删除草稿", exact: true }).click();
    await page.getByRole("button", { name: "确认继续", exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  const csrf = (await (await page.request.get("/api/auth/csrf")).json()).token;
  const publish = async (index: number, placement = "personal") => {
    const id = (await import("node:crypto")).randomUUID().replaceAll("-", "");
    const saved = await page.request.put(`/api/admin/announcements/${id}`, {
      headers: { "X-CSRF-TOKEN": csrf }, data: { title: `历史公告 ${index}`, body: "测试正文", placement, audience: placement === "login" ? "specified" : "all", languages: placement === "login" ? ["zh-CN"] : [], organizationIds: [], startsAt: null, endsAt: null, version: 0 },
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
      // The dialog opens before an uncached history page has returned.
      await expect(modal.locator("article").first()).toBeAttached();
      await modal.evaluate(element => { element.scrollTop = element.scrollHeight; });
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
      // The dialog opens before an uncached history page has returned.
      await expect(modal.locator("article").first()).toBeAttached();
      await modal.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(modal.locator("article")).toHaveCount(23);
    });
  } finally { await customerContext.close().catch(() => {}); }
  await test.step("notification center, preferences and management work in both languages", async () => {
    // Previous bulk announcement setup consumes the existing write quota; respect its window.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 61000 - (Date.now() - startedAt))));
    const token = (await (await page.request.get("/api/auth/csrf")).json()).token;
    const created = await page.request.post("/api/projects", { headers: { "X-CSRF-TOKEN": token }, data: {} });
    expect(created.ok()).toBeTruthy();
    const project = await created.json();
    for (const locale of ["zh-CN", "en-US"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${project.id}/edit/characters`);
      const hint = page.locator('input[id^="voiceHint-"]');
      await expect(hint).toBeVisible();
      await hint.focus();
      const grid = await page.locator(".character-grid").boundingBox();
      const upload = await page.locator(".reference-image-upload").boundingBox();
      expect(grid).not.toBeNull(); expect(upload).not.toBeNull();
      expect(upload!.y - (grid!.y + grid!.height)).toBeGreaterThanOrEqual(15);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/character-spacing-mobile-${locale}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/api/notifications/stream*", route => route.abort());

    const { execFileSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    // Seed a business event only in the disposable E2E database; delivery uses the real worker.
    execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE projects SET project_json=json_set(project_json,'$.projectName','Notification E2E'),status='submitted',version=version+1 WHERE id=?\",(sys.argv[2],)); c.execute(\"INSERT INTO notification_events(event_key,kind,project_id,actor_id,target_id) VALUES('e2e-workflow','workflow',?,'test-actor','')\",(sys.argv[2],)); c.commit(); c.close()", resolve("artifacts/e2e-data/platform.db"), project.id]);
    await page.goto("/zh-CN/notifications");
    await expect(page.getByRole("heading", { name: "项目进度已更新：Notification E2E", exact: true })).toBeVisible({ timeout: 35000 });
    await expect(page.getByRole("button", { name: "通知，1 条未读", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "通知，1 条未读", exact: true }).click();
    const quick = page.getByRole("dialog", { name: "通知", exact: true });
    await expect(quick).toBeVisible();
    await quick.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("button", { name: "通知，1 条未读", exact: true })).toBeVisible();
    // Simulate a different device changing read state while SSE is unavailable.
    const incoming = await (await page.request.get("/api/notifications")).json();
    expect((await page.request.post("/api/notifications/state", { headers: { "X-CSRF-TOKEN": token }, data: { action: "read", ids: [incoming.items[0].id] } })).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "标为未读", exact: true })).toBeVisible({ timeout: 35000 });
    await page.getByRole("button", { name: "标为未读", exact: true }).click();
    await expect(page.getByRole("button", { name: "标为已读", exact: true })).toBeVisible();
    await page.unroute("**/api/notifications/stream*");
    await page.getByRole("button", { name: "通知详情", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "通知详情", exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "通知详情", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("button", { name: "通知，0 条未读", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "标为未读", exact: true }).click();
    await page.getByRole("checkbox", { name: "选择：项目进度已更新：Notification E2E", exact: true }).check();
    await page.getByRole("button", { name: "归档选中", exact: true }).click();
    await expect(page.getByText("暂无通知", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "已归档", exact: true }).check();
    await page.getByRole("checkbox", { name: "选择：项目进度已更新：Notification E2E", exact: true }).check();
    await page.getByRole("button", { name: "取消归档", exact: true }).click();
    await page.goto("/en-US/notifications");
    await expect(page.getByRole("heading", { name: "Project progress updated: Notification E2E", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    const prefs = page.getByRole("dialog", { name: "Preferences", exact: true });
    await prefs.getByRole("checkbox", { name: "Show instant reminders", exact: true }).uncheck();
    await prefs.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prefs).toHaveCount(0);
    expect((await (await page.request.get("/api/notifications/preferences")).json()).toast).toBe(false);
    const storedPrefs = await (await page.request.get("/api/notifications/preferences")).json();
    expect((await page.request.put("/api/notifications/preferences", { headers: { "X-CSRF-TOKEN": token }, data: { ...storedPrefs, mutedKinds: ["workflow"] } })).ok()).toBeTruthy();
    const rules = await (await page.request.get("/api/admin/notifications/rules")).json();
    const workflowRule = rules.items.find((r: { kind: string }) => r.kind === "workflow");
    expect((await page.request.put("/api/admin/notifications/rules", { headers: { "X-CSRF-TOKEN": token }, data: { ...workflowRule, allowMute: false } })).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(prefs.getByRole("checkbox", { name: "Project progress", exact: true })).toHaveCount(0);
    await prefs.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prefs).toHaveCount(0);
    expect((await (await page.request.get("/api/notifications/preferences")).json()).mutedKinds).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Project progress updated: Notification E2E", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: "artifacts/notification-center-mobile-en.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/zh-CN/settings/notifications");
    await expect(page.getByRole("heading", { name: "通知发送记录", exact: true })).toBeVisible();
    const rule = page.locator(".notification-rule-list article").filter({ hasText: "项目进度" });
    await rule.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByRole("dialog", { name: "编辑通知规则", exact: true }).getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("http://127.0.0.1:5193/en-US/notifications");
    await expect(page.getByRole("heading", { name: "Project progress updated: Notification E2E", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open related item", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${project.id}`));
  });


});
