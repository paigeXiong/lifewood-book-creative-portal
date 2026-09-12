import { postAuthentication } from "./auth-request";
import { expect, test } from "@playwright/test";

test("customer wizard keeps mobile controls reachable in both languages", async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const csrf = async () => (await (await page.request.get("/api/auth/csrf")).json()).token;
  const headers = async () => ({"X-CSRF-TOKEN":await csrf()});
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login", {headers:await headers(),data:status.requiresBootstrap ? {displayName:"E2E Owner",email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",organizationName:"E2E"} : {email:"owner.e2e@lifewood.test",password:"E2E-owner-password-2026",rememberMe:false}});
  expect(auth.ok()).toBeTruthy();
  const me=await(await page.request.get("/api/me")).json();
  if(!me.organization){
    const org=await page.request.post("/api/admin/organizations",{headers:await headers(),data:{name:"Mobile fixture "+Date.now()}});expect(org.ok()).toBeTruthy();
    const assigned=await page.request.put(`/api/admin/users/${me.id}`,{headers:await headers(),data:{displayName:me.displayName,role:"owner",active:true,organizationId:(await org.json()).id}});expect(assigned.ok()).toBeTruthy();
  }
  await page.route("**/api/announcements**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
  const created=await page.request.post("/api/projects",{headers:await headers(),data:{}});expect(created.ok()).toBeTruthy();let draft=await created.json();
  const options=await(await page.request.get("/api/form-options?locale=en-US")).json();
  draft.creative.characters=[{id:"mobile-character",roleTypeId:options.roleTypes[0].id,name:"Mara",storyRole:"Lead",personality:"Curious",appearance:"Traveler",referenceImageUrls:[],referenceImages:[]}];
  draft.creative.visualStyleId=options.visualStyles[0].id;
  const creative=await page.request.put(`/api/projects/${draft.id}/creative`,{headers:await headers(),data:{version:draft.version,creative:draft.creative}});expect(creative.ok()).toBeTruthy();draft=await creative.json();
  draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};
  const voice=await page.request.put(`/api/projects/${draft.id}/voice-and-references`,{headers:await headers(),data:{version:draft.version,voiceAndReferences:draft.voiceAndReferences}});expect(voice.ok()).toBeTruthy();
  for(const locale of ["zh-CN","en-US"]) for(const width of [320,768]) for(const stage of ["project","characters","voice","style","references"]){
    await page.setViewportSize({width,height:width===320?740:480});
    await page.goto(`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/${stage}`);
    const footer=page.locator(".wizard-page .sticky-actions");await expect(footer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/edit/${stage}$`));
    const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth, viewport:innerWidth, overflow:[...document.querySelectorAll("body *")].filter(node=>node.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(node).visibility!=="hidden").slice(0,12).map(node=>({tag:node.tagName,cls:node.className,right:node.getBoundingClientRect().right}))}));
    expect.soft(layout.width<=layout.viewport+1,`${locale} ${width} ${stage}: ${JSON.stringify(layout)}`).toBe(true);
    const controls=await footer.locator("button,a").evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length>0).map(node=>{const r=node.getBoundingClientRect();return {text:node.textContent,left:r.left,right:r.right,bottom:r.bottom,height:r.height};}));
    for(const control of controls){expect.soft(control.left,JSON.stringify(control)).toBeGreaterThanOrEqual(0);expect.soft(control.right,JSON.stringify(control)).toBeLessThanOrEqual(width+1);expect.soft(control.height).toBeGreaterThanOrEqual(44);}
    if(width===320){
      expect.soft(await footer.evaluate(node=>node.getBoundingClientRect().height), `${stage} compact footer`).toBeLessThanOrEqual(140);
      if(stage==="project") {
        const account=page.locator(".profile-chip");await account.focus();await page.keyboard.press("Enter");
        const menu=page.locator(".account-popover");await expect(menu).toBeVisible();
        const bounds=await menu.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");await expect(menu).toHaveCount(0);await expect(account).toBeFocused();
      }
      const toggle=page.locator(".step-compact button");await toggle.focus();await page.keyboard.press("Enter");await expect(toggle).toHaveAttribute("aria-expanded","true");
      await page.keyboard.press("Enter");await expect(toggle).toHaveAttribute("aria-expanded","false");
      if(stage==="project"){
        const upload=page.locator(".upload-drop-prompt").first();await upload.focus();
        const [chooser]=await Promise.all([page.waitForEvent("filechooser"),page.keyboard.press("Enter")]);await chooser.setFiles([]);
        await expect(upload).toBeFocused();
        await page.keyboard.press("Tab");
        expect(await page.evaluate(()=>document.activeElement?.getAttribute("type"))).not.toBe("file");
        // Missing required material must focus the relevant upload entry, not leave focus on Continue.
        await footer.locator('button[type="submit"]').click();
        await expect(page.locator(".upload-drop-prompt:focus")).toHaveCount(1);
      }
      await page.screenshot({path:`artifacts/mobile-workflow-${stage}-${locale}.png`});
    }
  }
});
