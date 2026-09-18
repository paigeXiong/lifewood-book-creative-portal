import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { gotoInAccountLocale } from "../e2e/auth-request";
const headers = async (r: APIRequestContext) => ({ "X-CSRF-TOKEN": (await (await r.get("/api/auth/csrf")).json()).token });
const json = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
};

test("capture clean bilingual documentation examples", async ({ page, browser }) => {
  test.setTimeout(180000);
  expect((await (await page.request.get("/api/auth/status")).json()).requiresBootstrap).toBe(true);
  const password = "Isolated-demo-only-2026!";
  await json(await page.request.post("/api/auth/bootstrap", { headers: await headers(page.request), data: {
    displayName: "Demo Administrator", email: "admin@example.test", password, organizationName: "Northstar Books",
  } }));
  const owner = await (await page.request.get("/api/me")).json();
  await json(await page.request.post("/api/admin/users", { headers: await headers(page.request), data: {
    displayName: "Jamie Chen", email: "jamie@example.test", password, role: "customer", organizationId: owner.organization.id,
  } }));
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:5194", storageState: await page.context().storageState() });
  const admin = await adminContext.newPage();
  await json(await page.request.post("/api/auth/login", { headers: await headers(page.request), data: { email: "jamie@example.test", password, rememberMe: false } }));
  const options = await (await page.request.get("/api/form-options?locale=en-US")).json();
  const ids: string[] = [];
  for (const title of ["The Lantern Garden", "Across the Blue Horizon"]) {
    let draft = await json(await page.request.post("/api/projects", { headers: await headers(page.request), data: {} }));
    Object.assign(draft.project, { projectName: `${title} · Book trailer`, videoGoalId: options.videoGoals[0].id, audienceIds: [options.audiences[0].id] });
    Object.assign(draft.book, { title, authorName: "Morgan Ellis", genreId: options.genres[0].id, contentLanguageId: options.contentLanguages[0].id, videoDurationId: options.videoDurations.find((v: {allowsCustomValue?: boolean}) => !v.allowsCustomValue).id });
    draft = await json(await page.request.put(`/api/projects/${draft.id}/draft`, { headers: await headers(page.request), data: { version: draft.version, project: draft.project, book: draft.book } }));
    ids.push(draft.id);
    if (ids.length === 2) continue;
    draft.creative.characters = [{ id: "garden-guide", roleTypeId: options.roleTypes[0].id, name: "Mara", storyRole: "A guide exploring the garden", personality: "Curious and kind", appearance: "A traveler carrying a lantern", referenceImageUrls: [], referenceImages: [] }];
    draft.creative.visualStyleId = options.visualStyles[0].id;
    draft = await json(await page.request.put(`/api/projects/${draft.id}/creative`, { headers: await headers(page.request), data: { version: draft.version, creative: draft.creative } }));
    draft.voiceAndReferences.voiceover = { narrationEnabled: false, selectedVoiceIds: [] };
    draft.voiceAndReferences.creativeDirection.coreMessage = "Discover wonder in everyday journeys.";
    draft = await json(await page.request.put(`/api/projects/${draft.id}/voice-and-references`, { headers: await headers(page.request), data: { version: draft.version, voiceAndReferences: draft.voiceAndReferences } }));
    for (const category of options.sourceCategories.filter((x: {required: boolean}) => x.required)) {
      const image = category.accept.includes("image/jpeg");
      const buffer = image ? await readFile("apps/task-entry-web/public/style-previews/watercolor-v1.jpg") : Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
      draft = (await json(await page.request.post(`/api/projects/${draft.id}/files?categoryId=${category.id}`, { headers: await headers(page.request), multipart: { version: String(draft.version), categoryId: category.id, file: { name: image ? "illustrative-cover.jpg" : "demo-excerpt.pdf", mimeType: image ? "image/jpeg" : "application/pdf", buffer } } }))).draft;
    }
    await json(await page.request.post(`/api/projects/${draft.id}/submit`, { headers: await headers(page.request), data: { version: draft.version, idempotencyKey: randomUUID().replaceAll("-", "") } }));
  }
  try {
    for (const locale of ["zh-CN", "en-US"]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await admin.setViewportSize({ width: 1440, height: 1100 });
      const capture = async (name: string, selector: string) => {
        const target = page.locator(selector);
        await expect(target).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const box = (await target.boundingBox())!;
        const height = name === "customer-projects" ? 420 : name === "customer-intake" ? 900 : name === "customer-detail" ? 920 : box.height;
        await page.screenshot({ path: `docs/images/screenshots/${name}-${locale}.jpg`, type: "jpeg", quality: 90, animations: "disabled", fullPage: true, clip: { ...box, height: Math.min(height, box.height) } });
      };
      await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/tasks`);
      await expect(page.locator(".task-project-row")).toHaveCount(2);
      await capture("customer-projects", "#main-content");
      await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/tasks/${ids[1]}/edit/project`);
      await expect(page.getByRole("textbox").first()).toHaveValue("Across the Blue Horizon");
      await capture("customer-intake", "#main-content");
      await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${ids[0]}`);
      await expect(page.locator(".detail-header h1")).toContainText("The Lantern Garden");
      await capture("customer-detail", ".detail-page");
      await page.goto(`http://127.0.0.1:5193/${locale}/overview`);
      await expect(page.locator(".dashboard-loading")).toHaveCount(0);
      await expect(page.locator(".dashboard-toolbar")).toBeVisible();
      await capture("customer-overview", ".customer-dashboard");
      await gotoInAccountLocale(admin, `http://127.0.0.1:5194/${locale}/overview`);
      await expect(admin.locator(".overview-content .center-state")).toHaveCount(0);
      await expect(admin.locator(".overview-content")).toContainText(locale === "zh-CN" ? "平均需求完成时间" : "Average");
      await admin.locator(".overview-content").screenshot({ path: `docs/images/screenshots/admin-overview-${locale}.jpg`, type: "jpeg", quality: 90, animations: "disabled" });
    }
    // Preserve README image paths while the help center chooses locale-specific files.
    for (const name of ["customer-projects", "customer-intake", "customer-detail", "customer-overview", "admin-overview"])
      await copyFile(`docs/images/screenshots/${name}-zh-CN.jpg`, `docs/images/screenshots/${name}.jpg`);
  } finally { await adminContext.close(); }
});
