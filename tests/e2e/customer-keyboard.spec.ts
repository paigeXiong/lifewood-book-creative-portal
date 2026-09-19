import {test,expect,type Page,type Locator} from "@playwright/test";
import {postAuthentication,gotoInAccountLocale,withRateLimitCooldown} from "./auth-request";

async function tabTo(page:Page,target:Locator,limit=60,key="Tab"){
 for(let i=0;i<limit;i++){
  if(await target.evaluate(el=>el===document.activeElement))return;
  await page.keyboard.press(key);
 }
 await expect(target).toBeFocused();
}

test("customer keyboard navigation, feedback file selection and narrow layout",async({page,browser,browserName})=>{
 test.setTimeout(150000);page.setDefaultTimeout(10000);
 const owner=await browser.newContext({baseURL:"http://127.0.0.1:5194"});
 const headers=async(request=owner.request)=>({"X-CSRF-TOKEN":(await(await request.get("/api/auth/csrf")).json()).token});
 try{
  const status=await(await owner.request.get("/api/auth/status")).json();
  expect((await postAuthentication(owner.request,status.requiresBootstrap?"/api/auth/bootstrap":"/api/auth/login",{headers:await headers(),data:status.requiresBootstrap?{displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"}:{email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}})).ok()).toBeTruthy();
  const me=await(await owner.request.get("/api/me")).json();
  let org=me.organization?.id;
  if(!org){const response=await withRateLimitCooldown(async()=>owner.request.post("/api/admin/organizations",{headers:await headers(),data:{name:`Keyboard ${browserName} ${Date.now()}`}}));expect(response.ok()).toBeTruthy();org=(await response.json()).id;}
  const email=`keyboard-${browserName}-${Date.now()}@lifewood.test`,password="Keyboard-test-password-2026";
  expect((await withRateLimitCooldown(async()=>owner.request.post("/api/admin/users",{headers:await headers(),data:{displayName:"Keyboard client",email,password,role:"customer",organizationId:org}}))).ok()).toBeTruthy();
  expect((await postAuthentication(page.request,"/api/auth/login",{headers:await headers(page.request),data:{email,password,rememberMe:false}})).ok()).toBeTruthy();
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  for(const locale of ["zh-CN","en-US"]){
   await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:"reduce"});
   await gotoInAccountLocale(page,`http://127.0.0.1:5193/${locale}/tasks`);
   const feedback=page.locator(".feedback-trigger");await expect(feedback).toBeVisible();
   await page.keyboard.press("Tab");await expect(page.locator(".skip-link")).toBeFocused();
   await page.keyboard.press("Enter");await expect(page.locator("#main-content")).toBeFocused();
   await tabTo(page,feedback,15,"Shift+Tab");await page.keyboard.press("Enter");
   const dialog=page.locator("dialog[open]");await expect(dialog).toBeVisible();
   const description=dialog.locator("textarea");await expect(description).toBeFocused();
   await page.keyboard.type(`Keyboard feedback ${browserName} ${locale}`);
   // Native modal keeps keyboard navigation inside, in both directions.
   for(const key of ["Tab","Shift+Tab"]){for(let i=0;i<10;i++){
    await page.keyboard.press(key);
    expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy();
   }}
   const file=dialog.getByRole("button",{name:locale==="zh-CN"?"选择图片":"Choose image",exact:true});await tabTo(page,file,12);
   expect(await file.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe("none");
   const chooser=page.waitForEvent("filechooser");await page.keyboard.press("Enter");await(await chooser).setFiles({name:"keyboard.png",mimeType:"image/png",buffer:png});
   await expect(dialog.locator(".feedback-image-preview img")).toBeVisible();
   for(const key of ["Tab","Shift+Tab"]){for(let i=0;i<10;i++){
    await page.keyboard.press(key);
    expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy();
   }}
   await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(feedback).toBeFocused();
   await page.keyboard.press("Enter");await expect(description).toHaveValue(`Keyboard feedback ${browserName} ${locale}`);
   await expect(dialog.locator(".feedback-image-preview img")).toBeVisible();
   // 640 CSS px covers desktop reflow; 320 px checks the narrow mobile layout.
   for(const width of [640,320]){
    await page.setViewportSize({width,height:720});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    await page.screenshot({path:`artifacts/customer-keyboard-${browserName}-${locale}-${width}.png`});
   }
   const submit=dialog.locator('button[type="submit"]');await tabTo(page,submit,15);await page.keyboard.press("Enter");
   await expect(dialog.locator(".feedback-success")).toBeVisible();
   await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(feedback).toBeFocused();
  }
 }finally{await owner.close();}
});
