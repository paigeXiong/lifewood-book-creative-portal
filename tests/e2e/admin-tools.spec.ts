import { postAuthentication } from "./auth-request";
import {expect,test} from "@playwright/test";

test("audit context, exports and runtime health work in both languages",async({page})=>{
 test.setTimeout(120000);
 const token=(await(await page.request.get("/api/auth/csrf")).json()).token;
 const status=await(await page.request.get("/api/auth/status")).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?"/api/auth/bootstrap":"/api/auth/login",{headers:{"X-CSRF-TOKEN":token},data:status.requiresBootstrap?{displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"}:{email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});
 expect(auth.ok()).toBeTruthy();
 const csrf=(await(await page.request.get("/api/auth/csrf")).json()).token;
 const organizationName="Audit Tools Organization "+Date.now();
 const org=await page.request.post("/api/admin/organizations",{headers:{"X-CSRF-TOKEN":csrf},data:{name:organizationName}});expect(org.ok()).toBeTruthy();const organization=await org.json();
 const rules=await(await page.request.get("/api/admin/notifications/rules")).json();
 const rule=rules.items[0];const saved=await page.request.put("/api/admin/notifications/rules",{headers:{"X-CSRF-TOKEN":csrf},data:{...rule,enabled:!rule.enabled}});expect(saved.ok()).toBeTruthy();
 for(const locale of ["zh-CN","en-US"]){
  await page.setViewportSize({width:1366,height:900});
  await page.goto(`/${locale}/audit?action=notification.config`);
  await page.locator(".audit-detail-button").first().click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  await expect(dialog.locator(".audit-changes")).toContainText(locale==="zh-CN"?"启用":"Enabled");
  await expect(dialog.locator(".audit-changes")).not.toContainText("auditTools.");
  await page.screenshot({path:`artifacts/audit-details-${locale}.png`});
  await dialog.getByRole("button",{name:locale==="zh-CN"?"关闭":"Close",exact:true}).click();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:locale==="zh-CN"?"导出 CSV":"Export CSV",exact:true}).click();expect((await download).suggestedFilename()).toBe("audit.csv");
  await page.goto(`/${locale}/audit`);
  await page.getByRole("link",{name:organizationName,exact:true}).click();await expect(page).toHaveURL(new RegExp("organization="+organization.id));
  await page.goto(`/${locale}/organizations`);
  const wordmark=page.getByRole("img",{name:organizationName,exact:true});await expect(wordmark).toBeVisible();
  await expect.poll(()=>wordmark.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth===600&&image.naturalHeight===100)).toBeTruthy();
  await page.screenshot({path:`artifacts/organization-wordmarks-${locale}.png`});
  await page.getByRole("link",{name:organizationName,exact:true}).click();await expect(page).toHaveURL(new RegExp("organization="+organization.id));
  await page.goto(`/${locale}/settings/runtime`);
  await expect(page.locator(".runtime-health-grid")).toBeVisible();
  await expect(page.locator(".runtime-listener")).toHaveCount(2);
  await expect(page.locator("#runtime-customer-port")).toHaveValue("5193");
  await expect(page.locator("#runtime-admin-port")).toHaveValue("5194");
  await expect(page.locator(".runtime-form")).not.toContainText("runtimeListeners.");
  const original=await(await page.request.get("/api/admin/runtime-settings")).json();
  try {
    await page.locator("#runtime-customer-port").fill("5293");
    const saved=page.waitForResponse(r=>r.url().endsWith("/api/admin/runtime-settings")&&r.request().method()==="PUT");
    await page.locator(".runtime-actions button").click();expect((await saved).ok()).toBeTruthy();
    await expect(page.locator(".runtime-listener").first()).toContainText("5293");
    await expect(page.locator(".runtime-listener").first().locator(".runtime-current strong")).toContainText("5193");
    const conflicting=await page.request.put("/api/admin/runtime-settings",{headers:{"X-CSRF-TOKEN":csrf},data:{...original,customer:{...original.customer,port:original.port}}});expect(conflicting.status()).toBe(400);
  } finally {
    const restored=await page.request.put("/api/admin/runtime-settings",{headers:{"X-CSRF-TOKEN":csrf},data:original});expect(restored.ok()).toBeTruthy();
    await page.reload();await expect(page.locator("#runtime-customer-port")).toHaveValue("5193");
  }
  const help=page.locator(".runtime-field .help-popover-trigger").first();
  const popover=page.locator(".help-popover-content:popover-open");
  await expect(popover).toHaveCount(0);
  await help.click();await expect(popover).toContainText("Kestrel");
  await page.locator(".runtime-health header strong").click();await expect(popover).toHaveCount(0);
  await help.focus();await page.keyboard.press("Enter");await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");await expect(popover).toHaveCount(0);await expect(help).toBeFocused();

  await expect(page.locator(".runtime-health")).not.toContainText("runtimeHealth.");
  await page.screenshot({path:`artifacts/runtime-health-${locale}.png`});
  for(const route of ["audit","settings/runtime"]){
   await page.setViewportSize({width:390,height:844});await page.goto(`/${locale}/${route}`);
   await expect(page.locator(route==="audit"?".audit-readable-table":".runtime-health-grid")).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
   if(route==="settings/runtime"){
    const mobileHelp=page.locator(".runtime-field .help-popover-trigger").last();await mobileHelp.click();await expect(popover).toBeVisible();
    const box=await popover.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({path:`artifacts/runtime-help-mobile-${locale}.png`,fullPage:true});
    await page.keyboard.press("Escape");
   }

   await page.screenshot({path:`artifacts/admin-tools-${route.replace('/','-')}-mobile-${locale}.png`,fullPage:true});
  }
 }
});
