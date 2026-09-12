import { postAuthentication } from "./auth-request";
import {expect,test} from '@playwright/test';

test('profile supports compact browsing and on-demand editing in both languages',async({page})=>{
 test.setTimeout(90000);
 const csrf=(await(await page.request.get('/api/auth/csrf')).json()).token;
 const status=await(await page.request.get('/api/auth/status')).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?'/api/auth/bootstrap':'/api/auth/login',{headers:{'X-CSRF-TOKEN':csrf},data:status.requiresBootstrap?{displayName:'E2E Owner',email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',organizationName:'E2E'}:{email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}});
 expect(auth.ok()).toBeTruthy();
 let user=await(await page.request.get('/api/me')).json();
 let fail=false;
 await page.route('**/api/me',route=>route.fulfill({json:user}));
 await page.route('**/api/me/profile',async route=>{
   if(fail){await route.fulfill({status:500,json:{message:'Save failed'}});return;}
   user={...user,...route.request().postDataJSON()};await route.fulfill({json:user});
 });
 for(const locale of ['zh-CN','en-US']){
  await page.setViewportSize({width:1366,height:900});
  await page.goto(`http://127.0.0.1:5193/${locale}/profile`);
  const edit=page.locator('.profile-edit-button');
  await expect(edit).toBeVisible();
  await expect(page.locator('#profile-display-name')).toHaveCount(0);
  await page.screenshot({path:`artifacts/profile-refined-${locale}.png`});
  await edit.click();await expect(page.locator('#profile-display-name')).toBeFocused();
  await page.locator('#profile-display-name').fill('Unsaved name');
  await page.locator('.profile-actions button').first().click();
  await expect(edit).toBeFocused();
  await edit.click();await expect(page.locator('#profile-display-name')).toHaveValue(user.displayName);
  await page.locator('#profile-display-name').fill('Updated profile');
  fail=true;await page.locator('.profile-actions button[type=submit]').click();
  await expect(page.locator('.profile-form [role=alert]')).toBeVisible();
  await expect(page.locator('#profile-display-name')).toHaveValue('Updated profile');
  fail=false;await page.locator('.profile-actions button[type=submit]').click();
  await expect(page.locator('.profile-person-copy h1')).toHaveText('Updated profile');
  await expect(edit).toBeFocused();
  await page.locator('.profile-security-action').click();await expect(page.locator('.password-dialog')).toBeVisible();
  await page.locator('.password-dialog-title button').click();
  await page.locator('.login-devices-trigger').click();await expect(page.locator('.login-devices-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`artifacts/profile-refined-mobile-${locale}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  user={...user,displayName:'E2E Owner'};
 }
});
