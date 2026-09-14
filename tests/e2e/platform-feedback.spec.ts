import { gotoInAccountLocale, withRateLimitCooldown } from "./auth-request";
import { postAuthentication } from "./auth-request";
import {expect,test} from "@playwright/test";

test("platform feedback is submitted and answered through notifications in both languages",async({page,browser})=>{
 test.setTimeout(180000);
 const csrf=async()=>({"X-CSRF-TOKEN":(await(await page.request.get("/api/auth/csrf")).json()).token});
 const status=await(await page.request.get("/api/auth/status")).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?"/api/auth/bootstrap":"/api/auth/login",{headers:await csrf(),data:status.requiresBootstrap?{displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"}:{email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});expect(auth.ok()).toBeTruthy();
 const me=await(await page.request.get("/api/me")).json();
 const owner=await browser.newContext({baseURL:"http://127.0.0.1:5194",storageState:await page.context().storageState()});
 const admin=await owner.newPage();page.setDefaultTimeout(15000);admin.setDefaultTimeout(15000);
 try{for(const locale of ["zh-CN","en-US"]){
  const zh=locale==="zh-CN";const email=`feedback-${Date.now()}@lifewood.test`;const password="Feedback-fixture-password-2026";
  const ownerCsrf={"X-CSRF-TOKEN":(await(await owner.request.get("/api/auth/csrf")).json()).token};
  const created=await withRateLimitCooldown(() => owner.request.post("/api/admin/users",{headers:ownerCsrf,data:{displayName:"Feedback fixture",email,password,role:"customer",organizationId:me.organization?.id}}));expect(created.ok(), await created.text()).toBeTruthy();
  expect((await postAuthentication(page.request, "/api/auth/login",{headers:await csrf(),data:{email,password,rememberMe:false}})).ok()).toBeTruthy();
  await page.setViewportSize({width:390,height:844});await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/profile`);
  await page.getByRole("button",{name:zh?"问题反馈":"Report an issue",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:zh?"问题反馈":"Report an issue",exact:true});
  const description=`Feedback ${locale} ${Date.now()} <img src=x onerror=alert(1)>`;
  await dialog.getByLabel(zh?"问题描述":"Description",{exact:true}).fill(description);
  const fileInput=dialog.locator('input[type=file]');
  // File input cancellation bubbles; it must not be interpreted as Escape on the modal.
  await fileInput.dispatchEvent("cancel",{bubbles:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(zh?"问题描述":"Description",{exact:true})).toHaveValue(description);
  const [chooser]=await Promise.all([page.waitForEvent("filechooser"),fileInput.click()]);
  await expect(dialog).toBeVisible();
  const source=await page.evaluate(()=>{
   const canvas=document.createElement("canvas");canvas.width=1000;canvas.height=600;
   const ctx=canvas.getContext("2d")!;const pixels=ctx.createImageData(canvas.width,canvas.height);let seed=123456;
   for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){seed=(seed*1664525+1013904223)>>>0;pixels.data[i+c]=seed>>>24;}pixels.data[i+3]=255;}
   ctx.putImageData(pixels,0,0);ctx.fillStyle="#fff";ctx.fillRect(20,20,720,95);ctx.fillStyle="#173a2d";ctx.font="24px sans-serif";ctx.fillText("Platform error: screenshot text must stay readable",40,70);
   return canvas.toDataURL("image/png").split(",")[1];
  });
  const original=Buffer.from(source,"base64");expect(original.length).toBeGreaterThan(1_000_000);
  await chooser.setFiles({name:"screenshot.png",mimeType:"image/png",buffer:original});
  await expect(dialog.locator('.feedback-image-preview img')).toBeVisible();
  const processed=await dialog.locator('.feedback-image-preview img').getAttribute("src");expect(Buffer.from(processed!.split(",")[1],"base64").length).toBeLessThanOrEqual(1_000_000);
  expect(await dialog.locator('.feedback-image-preview img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(1000);
  await fileInput.dispatchEvent("cancel",{bubbles:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.feedback-image-preview img')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.screenshot({path:`artifacts/feedback-customer-${locale}-390.png`});
  if(zh)await page.route("**/api/feedback",async route=>{await route.fetch();await route.abort("failed");});
  await dialog.getByRole("button",{name:zh?"提交反馈":"Submit feedback",exact:true}).click();
  if(zh){await expect(dialog.getByRole("alert")).toBeVisible();await page.unroute("**/api/feedback");await dialog.getByRole("button",{name:"重试",exact:true}).click();}
  await expect(dialog.getByText(zh?"反馈已提交":"Feedback submitted",{exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:zh?"关闭":"Close",exact:true}).last().click();
  await gotoInAccountLocale(admin, `http://127.0.0.1:5194/${locale}/feedback`);
  await admin.getByRole("searchbox").fill(description.slice(0,30));
  const row=admin.getByRole("row").filter({hasText:description});await expect(row).toBeVisible();
  await row.getByRole("button",{name:zh?"查看详情":"View details",exact:true}).click();
  const review=admin.getByRole("dialog",{name:zh?"查看详情":"View details",exact:true});
  await expect(review.getByText(description,{exact:true})).toBeVisible();expect(await review.locator('img[src="x"]').count()).toBe(0);
  await review.getByLabel(zh?"处理状态":"Status",{exact:true}).selectOption("resolved");
  const reply=`Resolved ${locale} <b>plain text only</b>`;await review.getByLabel(zh?"处理回复":"Response",{exact:true}).fill(reply);
  await admin.screenshot({path:`artifacts/feedback-admin-${locale}.png`});
  if(zh){
   await admin.route("**/api/admin/feedback/*",route=>route.request().method()==="PUT"?route.abort("failed"):route.continue());
   await review.getByRole("button",{name:"保存并发送通知",exact:true}).click();await expect(review.getByRole("alert")).toBeVisible();
   await admin.unroute("**/api/admin/feedback/*");
   await admin.route("**/api/admin/feedback/*",route=>route.abort("failed"));
   await review.getByRole("button",{name:"刷新",exact:true}).click();
   await expect(review.getByRole("button",{name:"刷新",exact:true})).toBeEnabled();
   await expect(review.getByLabel("处理回复",{exact:true})).toHaveValue(reply);
   await expect(review.getByRole("button",{name:"保存并发送通知",exact:true})).toBeDisabled();
   await admin.unroute("**/api/admin/feedback/*");
   await review.getByRole("button",{name:"刷新",exact:true}).click();
   await expect(review.getByRole("button",{name:"保存并发送通知",exact:true})).toBeEnabled();
   await expect(review.getByLabel("处理回复",{exact:true})).toHaveValue(reply);
   await expect(review.getByLabel("处理状态",{exact:true})).toHaveValue("resolved");
  }
  await review.getByRole("button",{name:zh?"保存并发送通知":"Save and notify",exact:true}).click();await expect(review).toBeHidden();
  await expect.poll(async()=>{const feed=await(await page.request.get("http://127.0.0.1:5193/api/notifications?kind=feedback_reply")).json();return feed.items.length;},{timeout:20000}).toBe(1);
  await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/notifications`);
  await page.locator('.notification-row-actions button').first().click();
  await expect(page.locator('.feedback-notice-content').getByText(reply,{exact:true})).toBeVisible();
  await expect(page.locator('.feedback-notice-content').getByText(description,{exact:true})).toBeVisible();
  expect(await page.locator('.feedback-notice-content b').count()).toBe(0);expect(await page.locator('.feedback-notice-content textarea').count()).toBe(0);
  await page.screenshot({path:`artifacts/feedback-notification-${locale}-390.png`});
 }}finally{await owner.close();}
});
