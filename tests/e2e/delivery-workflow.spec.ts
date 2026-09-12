import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { postAuthentication } from "./auth-request";
const headers = async (request: APIRequestContext) => ({"X-CSRF-TOKEN":(await(await request.get("/api/auth/csrf")).json()).token});
function video() {
 const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const box=(name:string,...parts:Buffer[])=>{const data=Buffer.concat(parts);return Buffer.concat([u32(data.length+8),Buffer.from(name),data]);};
 const table=box("stbl",box("stsd",u32(0),u32(1),box("avc1")),box("stsz",u32(0),u32(1),u32(1)));
 const media=box("mdia",box("hdlr",Buffer.alloc(8),Buffer.from("vide")),box("minf",table));
 return Buffer.concat([box("ftyp",Buffer.from("isom"),u32(0),Buffer.from("isom")),box("mdat",Buffer.from([1])),box("moov",box("trak",media))]);
}
test("customer submission, requested changes and final delivery recover safely in both languages",async({page,browser})=>{
 test.setTimeout(240000);
 const status=await(await page.request.get("/api/auth/status")).json();
 const auth=await postAuthentication(page.request,status.requiresBootstrap?"/api/auth/bootstrap":"/api/auth/login",{headers:await headers(page.request),data:status.requiresBootstrap?{displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"}:{email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});expect(auth.ok()).toBeTruthy();
 const owner=await browser.newContext({baseURL:"http://127.0.0.1:5194",storageState:await page.context().storageState()});const admin=await owner.newPage();page.setDefaultTimeout(15000);admin.setDefaultTimeout(15000);
 await page.route("**/api/announcements**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
 const pdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
 try{for(const locale of ["zh-CN","en-US"]){
  const zh=locale==="zh-CN";const email=`delivery-${locale}-${Date.now()}@lifewood.test`,password="Delivery-fixture-password-2026";
  const me=await(await owner.request.get("/api/me")).json();
  const user=await owner.request.post("/api/admin/users",{headers:await headers(owner.request),data:{displayName:"Delivery customer",email,password,role:"customer",organizationId:me.organization?.id}});expect(user.ok()).toBeTruthy();
  expect((await postAuthentication(page.request,"/api/auth/login",{headers:await headers(page.request),data:{email,password,rememberMe:false}})).ok()).toBeTruthy();
  const options=await(await page.request.get("/api/form-options?locale="+locale)).json();
      const created=await page.request.post("/api/projects",{headers:await headers(page.request),data:{}});expect(created.ok()).toBeTruthy();let draft=await created.json();
      draft.project.videoGoalId=options.videoGoals[0].id;draft.project.audienceIds=[options.audiences[0].id];
      Object.assign(draft.book,{title:"Submission recovery",authorName:"Test author",genreId:options.genres[0].id,contentLanguageId:options.contentLanguages[0].id,videoDurationId:options.videoDurations.find((v:{allowsCustomValue?:boolean})=>!v.allowsCustomValue).id});
      const book=await page.request.put(`/api/projects/${draft.id}/draft`,{headers:await headers(page.request),data:{version:draft.version,project:draft.project,book:draft.book}});expect(book.ok(),await book.text()).toBeTruthy();draft=await book.json();
      draft.creative.characters=[{id:"submission-character",roleTypeId:options.roleTypes[0].id,name:"Mara",storyRole:"Lead",personality:"Curious",appearance:"Traveler",referenceImageUrls:[],referenceImages:[]}];draft.creative.visualStyleId=options.visualStyles[0].id;
      const creative=await page.request.put(`/api/projects/${draft.id}/creative`,{headers:await headers(page.request),data:{version:draft.version,creative:draft.creative}});expect(creative.ok(),await creative.text()).toBeTruthy();draft=await creative.json();
      draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};draft.voiceAndReferences.creativeDirection.coreMessage="Keep the main message.";
      const voice=await page.request.put(`/api/projects/${draft.id}/voice-and-references`,{headers:await headers(page.request),data:{version:draft.version,voiceAndReferences:draft.voiceAndReferences}});expect(voice.ok()).toBeTruthy();draft=await voice.json();
      for(const category of options.sourceCategories.filter((item:{required:boolean})=>item.required)){
        const image=category.accept.includes("image/png");expect(image||category.accept.includes("application/pdf")).toBe(true);
        const upload=await page.request.post(`/api/projects/${draft.id}/files?categoryId=${encodeURIComponent(category.id)}`,{headers:await headers(page.request),multipart:{version:String(draft.version),categoryId:category.id,file:{name:image?"cover.png":"manuscript.pdf",mimeType:image?"image/png":"application/pdf",buffer:image?png:pdf}}});expect(upload.ok(),await upload.text()).toBeTruthy();draft=(await upload.json()).draft;
      }

  await page.setViewportSize({width:zh?1366:390,height:900});
  await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/review`);
  await page.locator(".sticky-actions button.button-primary").click();await expect(page).toHaveURL(new RegExp(`/tasks/${draft.id}/submitted$`));
  await admin.goto(`/${locale}/projects?project=${draft.id}`);
  await admin.locator('[data-project-action="returns"] button').click();
  const returns=await(await owner.request.get(`/api/admin/projects/${draft.id}/revisions`,{headers:{"Accept-Language":locale}})).json();
  const returnDialog=admin.getByRole("dialog");
  const styleLabel=returns.units.find((u:{id:string})=>u.id==="style").label;
  await returnDialog.getByRole("checkbox",{name:new RegExp(styleLabel)}).check();
  await returnDialog.locator("textarea").fill("Please choose the other visual style.");
  await returnDialog.locator("footer button.primary").click();await expect(returnDialog).not.toBeVisible();
  await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}`);await expect(page).toHaveURL(new RegExp(`/edit/style$`));
  const alternate=options.visualStyles.find((v:{id:string})=>v.id!==draft.creative.visualStyleId);expect(alternate).toBeTruthy();
  await page.locator("label").filter({has:page.locator(`input[name="visualStyleId"][value="${alternate.id}"]`)}).click();
  await expect.poll(async()=>(await(await page.request.get(`/api/projects/${draft.id}`)).json()).creative.visualStyleId).toBe(alternate.id);
  await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/review`);await page.locator(".sticky-actions button.button-primary").click();await expect(page).toHaveURL(new RegExp(`/tasks/${draft.id}/submitted$`));
  const history=await(await owner.request.get(`/api/admin/projects/${draft.id}/revisions`,{headers:{"Accept-Language":locale}})).json();expect(history.rounds[0].submittedAt).toBeTruthy();expect(JSON.parse(history.rounds[0].afterSnapshot).creative.visualStyleId).toBe(alternate.id);
  await admin.reload();await admin.locator('[data-project-action="delivery"] button').click();
  const dialog=admin.getByRole("dialog");const bytes=video();await dialog.locator('input[name="file"]').setInputFiles({name:"final.mp4",mimeType:"video/mp4",buffer:bytes});await dialog.locator('textarea[name="note"]').fill("Final delivery <b>plain text</b>");
  let posts=0,checksAllowed=false;const postUrl=(url:URL)=>url.pathname===`/api/admin/projects/${draft.id}/deliveries`;
  await admin.route(postUrl,async route=>{if(route.request().method()!=="POST"){await route.continue();return;}posts++;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort("failed");});
  await admin.route(`**/api/admin/projects/${draft.id}/deliveries/uploads/*`,route=>checksAllowed?route.continue():route.abort("failed"));
  await dialog.locator('button.primary').click();await expect(dialog.getByRole("button",{name:zh?"检查发布结果":"Check publication result"})).toBeVisible();expect(posts).toBe(1);
  checksAllowed=true;await dialog.getByRole("button",{name:zh?"检查发布结果":"Check publication result"}).click();await expect(dialog).not.toBeVisible();expect(posts).toBe(1);
  await admin.unroute(postUrl);await admin.unroute(`**/api/admin/projects/${draft.id}/deliveries/uploads/*`);
  await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}`);
  const summary=page.locator(".project-progress-summary");await expect(summary).toBeVisible();await expect(summary.locator(".customer-delivery.ready")).toBeVisible();await expect(summary.locator("b")).toHaveCount(0);
  const downloadLink=summary.locator('a[href*="/deliveries/"]');const fileUrl=await downloadLink.getAttribute("href");
  const downloadEvent=page.waitForEvent("download");await downloadLink.click();const download=await downloadEvent;expect(await readFile((await download.path())!)).toEqual(bytes);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:`artifacts/project-progress-${locale}.png`});
  await admin.locator(".delivery-admin button.danger-link").click();const confirm=admin.getByRole("dialog");await confirm.locator("button").last().click();
  await expect.poll(async()=>(await(await page.request.get(`/api/projects/${draft.id}/deliveries`)).json()).length).toBe(0);
  expect((await page.request.get(fileUrl!)).status()).toBe(404);
  await expect(summary.locator(".customer-delivery.pending")).toBeVisible({timeout:15000});
  await expect(summary.locator('a[href*="/deliveries/"]')).toHaveCount(0);
 }}finally{await owner.close();}
});
