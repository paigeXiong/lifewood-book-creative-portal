import { postAuthentication } from "./auth-request";
import { expect, test } from "@playwright/test";

test("draft conflicts retain chosen input and fresh server fields in both languages", async ({ page }) => {
  test.setTimeout(90000);
  const csrf = async () => (await (await page.request.get("/api/auth/csrf")).json()).token;
  const headers = async () => ({"X-CSRF-TOKEN":await csrf()});
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {headers:await headers(),data:status.requiresBootstrap ? {displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"} : {email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});
  expect(auth.ok()).toBeTruthy();
  const me=await(await page.request.get("/api/me")).json();
  if(!me.organization){
    const org=await page.request.post("/api/admin/organizations",{headers:await headers(),data:{name:"Recovery fixture "+Date.now()}});expect(org.ok()).toBeTruthy();
    const assigned=await page.request.put(`/api/admin/users/${me.id}`,{headers:await headers(),data:{displayName:me.displayName,role:"owner",active:true,organizationId:(await org.json()).id}});expect(assigned.ok()).toBeTruthy();
  }
  await page.route("**/api/announcements**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
  for(const locale of ["zh-CN","en-US"]){
    const created=await page.request.post("/api/projects",{headers:await headers(),data:{}});expect(created.ok()).toBeTruthy();let draft=await created.json();
    await page.setViewportSize({width:locale==="en-US"?390:1366,height:900});
    await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/project`);
    await expect(page.locator("#title")).toBeVisible();
    draft.book.title="Server title";draft.book.authorName="Server author";
    const remote=await page.request.put(`/api/projects/${draft.id}/draft`,{headers:await headers(),data:{version:draft.version,project:draft.project,book:draft.book}});expect(remote.ok(),await remote.text()).toBeTruthy();draft=await remote.json();
    const failed=page.waitForResponse(r=>r.url().includes(`/projects/${draft.id}/draft`)&&r.request().method()==="PUT"&&r.status()===409);
    await page.locator("#title").fill("My unsaved title");await failed;
    await page.locator(".save-feedback button").click();
    const dialog=page.locator(".draft-recovery-dialog");await expect(dialog).toBeVisible();
    const title=dialog.locator("fieldset").filter({has:page.locator("legend",{hasText:locale==="zh-CN"?"书名":"Book title"})});
    await expect(title).toContainText("My unsaved title");await expect(title).toContainText("Server title");
    await title.getByRole("radio").first().check();
    // Another writer updates after the comparison opened. The first apply must only refresh.
    draft.book.authorName="Newest author";
    const again=await page.request.put(`/api/projects/${draft.id}/draft`,{headers:await headers(),data:{version:draft.version,project:draft.project,book:draft.book}});expect(again.ok()).toBeTruthy();draft=await again.json();
    await dialog.getByRole("button",{name:locale==="zh-CN"?"应用并继续编辑":"Apply and continue",exact:true}).click();
    await expect(dialog.getByRole("alert")).toBeVisible();await expect(title.getByRole("radio").last()).toBeChecked();
    await expect(page.locator("#title")).toHaveValue("My unsaved title");
    await title.getByRole("radio").first().check();
    await expect(dialog).toContainText("Newest author");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:`artifacts/draft-recovery-${locale}.png`});
    const saved=page.waitForResponse(r=>r.url().includes(`/projects/${draft.id}/draft`)&&r.request().method()==="PUT"&&r.ok());
    await dialog.getByRole("button",{name:locale==="zh-CN"?"应用并继续编辑":"Apply and continue",exact:true}).click();
    await expect(dialog).toHaveCount(0);await saved;
    await expect(page.locator("#title")).toHaveValue("My unsaved title");await expect(page.locator("#authorName")).toHaveValue("Newest author");
    const final=await(await page.request.get(`/api/projects/${draft.id}`)).json();expect(final.book.title).toBe("My unsaved title");expect(final.book.authorName).toBe("Newest author");
  }
});
