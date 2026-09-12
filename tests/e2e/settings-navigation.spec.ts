import { postAuthentication } from "./auth-request";
import {expect,test} from '@playwright/test';

test('settings selection slides across routes and respects reduced motion',async({page})=>{
 test.setTimeout(90000);
 await page.emulateMedia({reducedMotion:"no-preference"});
 await page.addInitScript(()=>{
  const original=document.startViewTransition.bind(document);
  (window as any).selectionFrames=[];
  document.startViewTransition=((update:any)=>{
   const transition=original(update);
   transition.ready.then(()=>{
    const movement=document.getAnimations().find(a=>(a as CSSAnimation).animationName?.includes('group-anim-settings-selection'));
    if(movement)(window as any).selectionFrames.push((movement.effect as KeyframeEffect).getKeyframes());
   }).catch(()=>{});
   return transition;
  }) as typeof document.startViewTransition;
 });
 const csrf=async()=>(await(await page.request.get('/api/auth/csrf')).json()).token;
 const status=await(await page.request.get('/api/auth/status')).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?'/api/auth/bootstrap':'/api/auth/login',{headers:{'X-CSRF-TOKEN':await csrf()},data:status.requiresBootstrap?{displayName:'E2E Owner',email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',organizationName:'E2E'}:{email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}});expect(auth.ok()).toBeTruthy();
 for(const locale of ['zh-CN','en-US']){
  await page.setViewportSize({width:1366,height:900});await page.goto(`/${locale}/settings/files`);
  const nav=page.locator('.settings-tabs');await expect(nav.locator('a')).toHaveCount(9);
  await nav.locator('a[href$="/characters"]').click();await expect(page).toHaveURL(/settings\/characters$/);
  await expect.poll(()=>page.evaluate(()=>(window as any).selectionFrames.length)).toBeGreaterThan(0);
  const frames=await page.evaluate(()=>(window as any).selectionFrames.at(-1));
  expect(frames[0].transform).not.toBe(frames.at(-1).transform);
  await nav.locator('a[href$="/backups"]').click();await nav.locator('a[href$="/runtime"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href',new RegExp('/runtime$'));
  await nav.locator('a[href$="/voices"]').focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/settings\/voices$/);
  await page.setViewportSize({width:390,height:844});await nav.locator('a[href$="/backups"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href',new RegExp('/backups$'));
  await expect.poll(()=>nav.evaluate(n=>{const a=n.querySelector('[aria-current="page"]')!.getBoundingClientRect(),b=n.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;})).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`artifacts/settings-motion-mobile-${locale}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
 await page.locator('.settings-tabs a[href$="/notifications"]').click();await expect(page).toHaveURL(/settings\/notifications$/);
 expect(await page.evaluate(()=>(window as any).selectionFrames.length)).toBe(0);
});
