import {expect,test} from "@playwright/test";
import {postAuthentication,withRateLimitCooldown} from "./auth-request";

test("account preference redirects both portals and survives explicit language changes",async({page})=>{
 test.setTimeout(120000);
 page.setDefaultTimeout(15000);
 const csrf=async()=>({"X-CSRF-TOKEN":(await(await page.request.get("/api/auth/csrf")).json()).token});
 const status=await(await page.request.get("/api/auth/status")).json();
 expect((await postAuthentication(page.request,status.requiresBootstrap?"/api/auth/bootstrap":"/api/auth/login",{headers:await csrf(),data:status.requiresBootstrap?{displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"}:{email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}})).ok()).toBeTruthy();
 await page.route("**/api/announcements**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
 const original=(await(await page.request.get("/api/me")).json()).locale;
 try{
  expect((await withRateLimitCooldown(async()=>page.request.put("/api/me/preferences",{headers:await csrf(),data:{locale:"en-US"}}))).ok()).toBeTruthy();
  await page.goto("http://127.0.0.1:5193/zh-CN/tasks?status=action_required&sort=project#list");
  await expect(page).toHaveURL("http://127.0.0.1:5193/en-US/tasks?status=action_required&sort=project#list");
  await expect(page.locator("html")).toHaveAttribute("lang","en-US");
  await page.goto("/zh-CN/projects?search=retained#details");
  await expect(page).toHaveURL(/\/en-US\/projects\?search=retained#details$/);
  const language=page.locator(".topbar select").first();
  await language.selectOption("zh-CN");
  await expect(page).toHaveURL(/\/zh-CN\/projects\?search=retained#details$/);
  expect((await(await page.request.get("/api/me")).json()).locale).toBe("zh-CN");
  await page.route("**/api/me/preferences",route=>route.fulfill({status:500,json:{message:"Save failed"}}));
  await language.selectOption("en-US");await expect(page.locator(".topbar [role=alert]")).toBeVisible();
  await expect(language).toHaveValue("zh-CN");await expect(page).toHaveURL(/\/zh-CN\/projects\?search=retained#details$/);
  await page.unroute("**/api/me/preferences");
  await language.selectOption("en-US");await expect(page).toHaveURL(/\/en-US\/projects\?search=retained#details$/);
  await page.goto("http://127.0.0.1:5193/zh-CN/profile");await expect(page).toHaveURL(/\/en-US\/profile$/);
  await page.locator("#profile-language").selectOption("zh-CN");await expect(page).toHaveURL(/\/zh-CN\/profile$/);
  await page.goto("http://127.0.0.1:5193/en-US/tasks");await expect(page).toHaveURL(/\/zh-CN\/tasks$/);
  // Returning from login uses the preference while retaining the deep-link suffix.
  expect((await withRateLimitCooldown(async()=>page.request.put("/api/me/preferences",{headers:await csrf(),data:{locale:"en-US"}}))).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/logout",{headers:await csrf()})).ok()).toBeTruthy();
  await page.goto("http://127.0.0.1:5193/zh-CN/tasks?status=action_required#return");
  await expect(page).toHaveURL(/\/zh-CN\/login$/);await expect(page.locator("html")).toHaveAttribute("lang","zh-CN");
  await page.getByLabel("邮箱",{exact:true}).fill("owner.e2e@lifewood.test");
  await page.locator('input[type="password"]').fill("E2E-owner-password-2026");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL("http://127.0.0.1:5193/en-US/tasks?status=action_required#return");
 }finally{
  await page.unroute("**/api/me/preferences");
  await page.request.put("/api/me/preferences",{headers:await csrf(),data:{locale:original??"zh-CN"}});
 }
});
