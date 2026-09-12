import { postAuthentication } from "./auth-request";
import { expect, test } from "@playwright/test";

test("submission recovery distinguishes committed, unknown, and retryable results", async ({page}) => {
  test.setTimeout(150000);
  const csrf = async () => (await (await page.request.get("/api/auth/csrf")).json()).token;
  const headers = async () => ({"X-CSRF-TOKEN":await csrf()});
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {headers:await headers(),data:status.requiresBootstrap ? {displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"} : {email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});
  expect(auth.ok()).toBeTruthy();
  const me=await(await page.request.get("/api/me")).json();
  if(!me.organization){
    const org=await page.request.post("/api/admin/organizations",{headers:await headers(),data:{name:"Submission fixture "+Date.now()}});expect(org.ok()).toBeTruthy();
    const assigned=await page.request.put(`/api/admin/users/${me.id}`,{headers:await headers(),data:{displayName:me.displayName,role:"owner",active:true,organizationId:(await org.json()).id}});expect(assigned.ok()).toBeTruthy();
  }
  await page.route("**/api/announcements**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
  const organizationId=(await(await page.request.get("/api/me")).json()).organization.id;
  const owner=await page.context().browser()!.newContext({baseURL:"http://127.0.0.1:5194",storageState:await page.context().storageState()});
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  const pdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  try { for(const locale of ["zh-CN","en-US"]){
    const email=`submit-${locale}-${Date.now()}@lifewood.test`;const password="Submission-fixture-password-2026";
    const ownerToken=(await(await owner.request.get("/api/auth/csrf")).json()).token;
    const user=await owner.request.post("/api/admin/users",{headers:{"X-CSRF-TOKEN":ownerToken},data:{displayName:"Submission fixture",email,password,role:"customer",organizationId}});expect(user.ok()).toBeTruthy();
    const login=await postAuthentication(page.request, "/api/auth/login",{headers:await headers(),data:{email,password,rememberMe:false}});expect(login.ok()).toBeTruthy();
    const options=await(await page.request.get("/api/form-options?locale="+locale)).json();
    for(const scenario of ["committed","unknown","retry"]){
      const created=await page.request.post("/api/projects",{headers:await headers(),data:{}});expect(created.ok()).toBeTruthy();let draft=await created.json();
      draft.project.videoGoalId=options.videoGoals[0].id;draft.project.audienceIds=[options.audiences[0].id];
      Object.assign(draft.book,{title:"Submission recovery",authorName:"Test author",genreId:options.genres[0].id,contentLanguageId:options.contentLanguages[0].id,videoDurationId:options.videoDurations.find((v:{allowsCustomValue?:boolean})=>!v.allowsCustomValue).id});
      const book=await page.request.put(`/api/projects/${draft.id}/draft`,{headers:await headers(),data:{version:draft.version,project:draft.project,book:draft.book}});expect(book.ok(),await book.text()).toBeTruthy();draft=await book.json();
      draft.creative.characters=[{id:"submission-character",roleTypeId:options.roleTypes[0].id,name:"Mara",storyRole:"Lead",personality:"Curious",appearance:"Traveler",referenceImageUrls:[],referenceImages:[]}];draft.creative.visualStyleId=options.visualStyles[0].id;
      const creative=await page.request.put(`/api/projects/${draft.id}/creative`,{headers:await headers(),data:{version:draft.version,creative:draft.creative}});expect(creative.ok(),await creative.text()).toBeTruthy();draft=await creative.json();
      draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};draft.voiceAndReferences.creativeDirection.coreMessage="Keep the main message.";
      const voice=await page.request.put(`/api/projects/${draft.id}/voice-and-references`,{headers:await headers(),data:{version:draft.version,voiceAndReferences:draft.voiceAndReferences}});expect(voice.ok()).toBeTruthy();draft=await voice.json();
      for(const category of options.sourceCategories.filter((item:{required:boolean})=>item.required)){
        const image=category.accept.includes("image/png");expect(image||category.accept.includes("application/pdf")).toBe(true);
        const upload=await page.request.post(`/api/projects/${draft.id}/files?categoryId=${encodeURIComponent(category.id)}`,{headers:await headers(),multipart:{version:String(draft.version),categoryId:category.id,file:{name:image?"cover.png":"manuscript.pdf",mimeType:image?"image/png":"application/pdf",buffer:image?png:pdf}}});expect(upload.ok(),await upload.text()).toBeTruthy();draft=(await upload.json()).draft;
      }
      const beforeVersion=draft.version;
      const validation=await page.request.post(`/api/projects/${draft.id}/validate`,{headers:await headers(),data:{version:beforeVersion}});expect(await validation.json()).toMatchObject({valid:true});
      const posts:Array<{version:number;idempotencyKey:string}>=[];let sent=false;let allowCheck=scenario!=="unknown";
      const submitPattern=`**/api/projects/${draft.id}/submit*`;const readPattern=(url:URL)=>url.pathname===`/api/projects/${draft.id}`;
      await page.route(submitPattern,async route=>{
        posts.push(route.request().postDataJSON());
        if(!sent){sent=true;if(scenario!=="retry"){const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();}await route.abort("failed");return;}
        await route.continue();
      });
      await page.route(readPattern,async route=>{if(sent&&!allowCheck)await route.abort("failed");else await route.continue();});
      try {
        await page.setViewportSize({width:locale==="en-US"?390:1366,height:900});
        await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/review`);
        const action=page.locator(".sticky-actions button.button-primary");await expect(action).toBeVisible();await action.click();
        if(scenario==="unknown"){
          await expect(action).toHaveText(locale==="zh-CN"?"检查提交结果":"Check submission result");expect(posts).toHaveLength(1);
          await page.screenshot({path:`artifacts/submission-unknown-${locale}.png`});
          allowCheck=true;await action.click();
        } else if(scenario==="retry"){
          await expect(action).toHaveText(locale==="zh-CN"?"重试提交":"Retry submission");await action.click();
        }
        await expect(page).toHaveURL(new RegExp(`/tasks/${draft.id}/submitted$`));
        await expect(page.locator(".submitted-receipt")).toBeVisible();
        expect(posts).toHaveLength(scenario==="retry"?2:1);if(posts.length===2)expect(posts[1]).toEqual(posts[0]);
        const saved=await(await page.request.get(`/api/projects/${draft.id}`)).json();expect(saved.status).toBe("submitted");expect(saved.version).toBe(beforeVersion+1);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      } finally {await page.unroute(submitPattern);await page.unroute(readPattern);}
    }
  }} finally{await owner.close();}
});
