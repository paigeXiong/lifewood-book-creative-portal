import {expect,test} from '@playwright/test';
test('backup alerts have localized owner rules and open backup management',async({page})=>{
 const csrf=async()=>(await(await page.request.get('/api/auth/csrf')).json()).token;
 const status=await(await page.request.get('/api/auth/status')).json();
 const auth=await page.request.post(status.requiresBootstrap?'/api/auth/bootstrap':'/api/auth/login',{headers:{'X-CSRF-TOKEN':await csrf()},data:status.requiresBootstrap?{displayName:'E2E Owner',email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',organizationName:'E2E'}:{email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}});expect(auth.ok()).toBeTruthy();
 let language='zh-CN';
 await page.route(/\/api\/notifications(?:\?|$)/,route=>route.fulfill({json:{items:[{id:990001,kind:'backup_failed',projectId:'',projectTitle:'',actor:'',createdAt:'2026-09-11T00:00:00Z',read:false,archived:false,state:'pending',targetId:'',title:language==='zh-CN'?'自动备份失败，请检查备份状态':'Automatic backup failed. Check backup status.',level:'action'}],nextCursor:null,watermark:990001,unread:1}}));
 await page.route('**/api/notifications/990001/target?*',route=>route.fulfill({json:{path:new URL(route.request().url()).searchParams.get('admin')==='true'?`/${language}/settings/backups`:`/api/portals/backups?locale=${language}`}}));
 for(const locale of ['zh-CN','en-US']){
  language=locale;await page.goto(`/${locale}/settings/notifications`);
  const rule=page.locator('.notification-rule-list article').filter({has:page.getByText(locale==='zh-CN'?'自动备份失败':'Automatic backup failed',{exact:true})});
  await rule.getByRole('button',{name:locale==='zh-CN'?'编辑':'Edit',exact:true}).click();
  const dialog=page.getByRole('dialog');const audience=dialog.locator('select').filter({has:page.locator('option[value="owners"]')});await expect(audience).toBeDisabled();await expect(audience).toHaveValue('owners');
  await page.goto(`/${locale}/notifications`);await expect(page.locator('.notification-list')).toContainText(locale==='zh-CN'?'自动备份失败，请检查备份状态':'Automatic backup failed. Check backup status.');
  await page.getByRole('button',{name:locale==='zh-CN'?'查看备份':'View backups',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/${locale}/settings/backups$`));await expect(page.locator('.backup-surface')).toBeVisible();
  // Customer portal uses the server's configured admin address, rather than assuming a port.
  await page.goto(`http://127.0.0.1:5193/${locale}/notifications`);await page.getByRole('button',{name:locale==='zh-CN'?'查看备份':'View backups',exact:true}).click();await expect(page).toHaveURL(`http://127.0.0.1:5194/${locale}/settings/backups`);await expect(page.locator('.backup-surface')).toBeVisible();
 }
});
