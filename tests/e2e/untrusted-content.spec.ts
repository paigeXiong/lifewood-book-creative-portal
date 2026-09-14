import { gotoInAccountLocale } from "./auth-request";
import { postAuthentication } from "./auth-request";
import {expect,test} from '@playwright/test';

test('unreviewed project text never becomes embedded HTML in either portal',async({page})=>{
 test.setTimeout(90000);
 const csrf=async()=>(await(await page.request.get('/api/auth/csrf')).json()).token;
 const status=await(await page.request.get('/api/auth/status')).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?'/api/auth/bootstrap':'/api/auth/login',{headers:{'X-CSRF-TOKEN':await csrf()},data:status.requiresBootstrap?{displayName:'E2E Owner',email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',organizationName:'E2E'}:{email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}});expect(auth.ok()).toBeTruthy();
 const account=await(await page.request.get('/api/me')).json();
 if(!account.organization){
  const createdOrganization=await page.request.post('/api/admin/organizations',{headers:{'X-CSRF-TOKEN':await csrf()},data:{name:'Injection fixture '+Date.now()}});expect(createdOrganization.ok()).toBeTruthy();
  const organization=await createdOrganization.json();const assigned=await page.request.put(`/api/admin/users/${account.id}`,{headers:{'X-CSRF-TOKEN':await csrf()},data:{displayName:account.displayName,role:'owner',active:true,organizationId:organization.id}});expect(assigned.ok()).toBeTruthy();
 }
 const created=await page.request.post('/api/projects',{headers:{'X-CSRF-TOKEN':await csrf()},data:{}});expect(created.ok()).toBeTruthy();
 const draft=await created.json();
 const payload='<img data-injection-probe src=x onerror="window.__injected=1"><script data-injection-probe>window.__injected=1</script><iframe data-injection-probe srcdoc="attack"></iframe><svg data-injection-probe onload="window.__injected=1"></svg>';
 const links=['javascript:window.__injected=1','data:text/html,<script>window.__injected=1</script>','java\nscript:window.__injected=1','https://example.test/reference'];
 draft.status='submitted';draft.project.projectName=payload;draft.project.clientName=payload;draft.book.title=payload;draft.book.synopsis=payload;draft.book.authorName=payload;
 draft.voiceAndReferences.competitorUrls=links;
 draft.voiceAndReferences.assets=[{id:'unsafe-link',fileName:payload,url:links[1],categoryId:'reference',contentType:'text/plain',sizeBytes:12}];
 const detail={project:draft,ownerId:'test',ownerName:payload,ownerEmail:'test@example.test',workflowStatus:'new',priority:'normal',workflowUpdatedAt:draft.updatedAt,notes:[]};
 await page.route('**/api/admin/projects?*',route=>route.fulfill({json:{items:[{id:draft.id,projectName:payload,bookTitle:payload,clientName:payload,ownerName:payload,status:'submitted',workflowStatus:'new',priority:'normal',updatedAt:draft.updatedAt}],total:1,page:1,pageSize:20}}));
 await page.route(`**/api/admin/projects/${draft.id}`,route=>route.fulfill({json:detail}));
 await page.route(`**/api/projects/${draft.id}`,route=>route.fulfill({json:draft}));
 await page.addInitScript(()=>{(window as any).__injected=0;});
 for(const locale of ['zh-CN','en-US']){
  for(const [portal,url] of [['customer',`http://127.0.0.1:5193/${locale}/tasks/${draft.id}`],['admin',`http://127.0.0.1:5194/${locale}/projects?project=${draft.id}`]]){
   await gotoInAccountLocale(page, url);
   await expect(page.locator('#main-content')).toContainText(payload);
   await expect(page.locator('a[href="https://example.test/reference"]')).toHaveCount(1);
   await expect(page.locator('[data-injection-probe]')).toHaveCount(0);
   expect(await page.evaluate(()=>(window as any).__injected)).toBe(0);
   expect(await page.locator('a[href]').evaluateAll(nodes=>nodes.some(node=>/^\s*(javascript|data|vbscript):/i.test(node.getAttribute('href')??'')))).toBe(false);
   await page.screenshot({path:`artifacts/untrusted-content-${portal}-${locale}.png`});
  }
 }
});
