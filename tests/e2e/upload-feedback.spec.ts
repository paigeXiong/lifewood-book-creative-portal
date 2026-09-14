import { gotoInAccountLocale } from "./auth-request";
import { postAuthentication } from "./auth-request";
import { expect, test } from "@playwright/test";

test("customer uploads retain files and edits through a lost response in both languages", async ({page}) => {
  test.setTimeout(120000);
  const csrf = async () => (await (await page.request.get("/api/auth/csrf")).json()).token;
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {headers:{"X-CSRF-TOKEN":await csrf()},data:status.requiresBootstrap ? {displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"} : {email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});
  expect(auth.ok()).toBeTruthy();
  const me = await (await page.request.get("/api/me")).json();
  if(!me.organization) {
    const organization=await page.request.post("/api/admin/organizations",{headers:{"X-CSRF-TOKEN":await csrf()},data:{name:"Upload fixture "+Date.now()}});expect(organization.ok()).toBeTruthy();
    const assigned=await page.request.put(`/api/admin/users/${me.id}`,{headers:{"X-CSRF-TOKEN":await csrf()},data:{displayName:me.displayName,role:"owner",active:true,organizationId:(await organization.json()).id}});expect(assigned.ok()).toBeTruthy();
  }
  const organizationId=(await(await page.request.get("/api/me")).json()).organization.id;
  const owner=await page.context().browser()!.newContext({baseURL:"http://127.0.0.1:5194",storageState:await page.context().storageState()});
  // Announcements are outside this upload scenario; isolate their automatic modal.
  await page.route("**/api/announcements**", route=>route.fulfill({json:{items:[],nextCursor:null}}));
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  try { for(const locale of ["zh-CN","en-US"]) {
    // Separate real customers keep fixture writes below the production per-account rate limit.
    const email=`upload-${locale}-${Date.now()}@lifewood.test`;
    const token=(await(await owner.request.get("/api/auth/csrf")).json()).token;
    const createdUser=await owner.request.post("/api/admin/users",{headers:{"X-CSRF-TOKEN":token},data:{displayName:"Upload fixture",email,password:"Upload-fixture-password-2026",role:"customer",organizationId}});
    expect(createdUser.ok(),await createdUser.text()).toBeTruthy();
    const signedIn=await postAuthentication(page.request, "/api/auth/login",{headers:{"X-CSRF-TOKEN":await csrf()},data:{email,password:"Upload-fixture-password-2026",rememberMe:false}});expect(signedIn.ok()).toBeTruthy();
    for(const stage of ["project","characters","style","references"]) {
    const created=await page.request.post("/api/projects",{headers:{"X-CSRF-TOKEN":await csrf()},data:{}});expect(created.ok()).toBeTruthy();
    let draft=await created.json();
    const options=await(await page.request.get("/api/form-options?locale="+locale)).json();
    if(stage!=="project") {
      draft.creative.characters=[{id:"upload-character",roleTypeId:options.roleTypes[0].id,name:"Mara",storyRole:"Lead",personality:"Curious",appearance:"Traveler",referenceImageUrls:[],referenceImages:[]}];
      draft.creative.visualStyleId=options.visualStyles[0].id;
      const saved=await page.request.put(`/api/projects/${draft.id}/creative`,{headers:{"X-CSRF-TOKEN":await csrf()},data:{version:draft.version,creative:draft.creative}});expect(saved.ok()).toBeTruthy();draft=await saved.json();
      draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};
      const voice=await page.request.put(`/api/projects/${draft.id}/voice-and-references`,{headers:{"X-CSRF-TOKEN":await csrf()},data:{version:draft.version,voiceAndReferences:draft.voiceAndReferences}});expect(voice.ok()).toBeTruthy();draft=await voice.json();
    }
    const category=stage==="project"?"book-cover":stage==="characters"?"character-reference":stage==="style"?"style-reference":options.referenceCategories.find((item:{id:string;accept:string[];maxFiles:number})=>!['character-reference','style-reference'].includes(item.id)&&item.accept.includes('image/png')&&item.maxFiles>=3)?.id;
    expect(category).toBeTruthy();
    const requests:string[]=[];let failed=false;let committed=false;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
    const pattern=`**/api/projects/${draft.id}/files?*`;
    await page.route(pattern,async route=>{
      if(route.request().method()!=="POST")return route.continue();
      const body=route.request().postDataBuffer()!.toString("utf8");
      const name=body.match(/filename="([^"]+)"/)?.[1]??"";requests.push(name);
      if(name==="first.png"&&!failed){failed=true;const response=await route.fetch();expect(response.ok()).toBeTruthy();committed=true;await gate;await route.abort("failed");return;}
      await route.continue();
    });
    try {
      await page.setViewportSize({width:locale==="en-US"?390:1366,height:900});
      await gotoInAccountLocale(page, `http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/${stage}`);
      const input=category?page.locator(`input[type=file][id$="${category}"]`):page.locator('.upload-drop-card input[type=file]').first();
      await expect(input).toBeAttached();
      await input.setInputFiles(["first.png","second.png","third.png"].map(name=>({name,mimeType:"image/png",buffer:png})));
      await expect.poll(()=>committed).toBe(true);
      const card=input.locator('..');
      const row=card.locator('.file-transfers li').filter({hasText:"first.png"});
      // Playwright holds the browser request while route.fetch commits it independently.
      // Native byte progress is covered by the transport test; this verifies pending UI and replay.
      await expect(row.locator("progress")).toBeVisible();
      const queued=card.locator('.file-transfers li').filter({hasText:"third.png"});
      await queued.getByRole("button").click();await expect(queued).toHaveCount(0);
      if(stage==="characters")await page.locator('[id^="characterName-"]').fill("Changed during upload");
      await row.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
      await page.screenshot({path:`artifacts/upload-progress-${stage}-${locale}.png`});
      release();
      const retry=row.getByRole("button",{name:locale==="zh-CN"?"重试上传 first.png":"Retry upload of first.png",exact:true});
      await expect(retry).toBeEnabled();await retry.click();
      await expect(card.locator('.file-transfers li')).toHaveCount(0);
      expect(requests).toEqual(["first.png","first.png","second.png"]);
      const current=await(await page.request.get(`/api/projects/${draft.id}`)).json();
      const assets=stage==="project"?current.book.sourceAssets:stage==="characters"?current.creative.characters[0].referenceImages:stage==="style"?current.creative.styleReferenceImages:current.voiceAndReferences.assets;
      expect(assets.map((asset:{fileName:string})=>asset.fileName).sort()).toEqual(["first.png","second.png"]);
      if(stage==="characters")await expect(page.locator('[id^="characterName-"]')).toHaveValue("Changed during upload");
    } finally {release();await page.unroute(pattern);}
    }
  }} finally {await owner.close();}
});
