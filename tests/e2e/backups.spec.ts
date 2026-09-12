import { postAuthentication } from "./auth-request";
import {expect,test} from '@playwright/test';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
test('backup management works in both languages',async({page})=>{
 test.setTimeout(120000);
 const csrf=async()=>(await(await page.request.get('/api/auth/csrf')).json()).token;
 const status=await(await page.request.get('/api/auth/status')).json();
 const auth=await postAuthentication(page.request, status.requiresBootstrap?'/api/auth/bootstrap':'/api/auth/login',{headers:{'X-CSRF-TOKEN':await csrf()},data:status.requiresBootstrap?{displayName:'E2E Owner',email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',organizationName:'E2E'}:{email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}});expect(auth.ok()).toBeTruthy();
 for(const locale of ['zh-CN','en-US']){
  await page.setViewportSize({width:1366,height:900});await page.goto(`/${locale}/settings/backups`);
  await expect(page.locator('.backup-surface')).toBeVisible();
  await expect(page.locator('.backup-surface')).not.toContainText('backups.');
  await page.getByRole('button',{name:locale==='zh-CN'?'备份策略':'Backup policy',exact:true}).click();
  const modal=page.getByRole('dialog');await expect(modal).toBeVisible();
  await modal.getByLabel(locale==='zh-CN'?'自动备份最多保留份数':'Maximum scheduled backups').fill('8');
  // Keep scheduling off in the test environment; exercise persistence without scheduling a real run.
  await modal.getByLabel(locale==='zh-CN'?'启用自动备份':'Enable scheduled backups').uncheck();
  await modal.getByRole('button',{name:locale==='zh-CN'?'保存':'Save',exact:true}).click();await expect(modal).toHaveCount(0);
  await page.getByRole('button',{name:locale==='zh-CN'?'创建备份':'Create backup',exact:true}).click();
  const row=page.locator('.backup-table tbody tr').first();
  await expect(row).toContainText(locale==='zh-CN'?'校验通过':'Verification passed',{timeout:60000});
  const previousCheck=(await(await page.request.get('/api/admin/backups')).json()).items[0].verifiedAt;
  await row.getByRole('button',{name:locale==='zh-CN'?'校验备份':'Verify backup',exact:true}).click();
  await expect.poll(async()=>{const data=await(await page.request.get('/api/admin/backups')).json();return data.current==null && data.items[0].verificationStatus==='passed' && data.items[0].verifiedAt!==previousCheck;},{timeout:60000}).toBeTruthy();
  await page.getByLabel(locale==='zh-CN'?'校验结果':'Verification result',{exact:true}).selectOption('damaged');await expect(page.locator('.backup-table tbody tr')).toHaveCount(0);
  await page.getByLabel(locale==='zh-CN'?'校验结果':'Verification result',{exact:true}).selectOption('passed');await expect(row).toBeVisible();
  await page.getByLabel(locale==='zh-CN'?'校验结果':'Verification result',{exact:true}).selectOption('');
  const downloaded=page.waitForEvent('download');await row.getByRole('button',{name:locale==='zh-CN'?'下载备份':'Download backup',exact:true}).click();const archive=await downloaded;expect(archive.suggestedFilename()).toMatch(/\.zip$/);await archive.saveAs(`artifacts/backup-fixture-${locale}.zip`);
  await row.getByRole('button',{name:locale==='zh-CN'?'恢复备份':'Restore backup',exact:true}).click();
  const restoreModal=page.getByRole('dialog');await expect(restoreModal).toContainText(locale==='zh-CN'?'预检通过':'Preflight passed',{timeout:60000});
  const confirm=restoreModal.getByRole('button',{name:locale==='zh-CN'?'创建安全备份并恢复':'Back up and restore',exact:true});await expect(confirm).toBeDisabled();
  await restoreModal.getByPlaceholder('RESTORE').fill('RESTORE');await expect(confirm).toBeEnabled();
  await page.screenshot({path:`artifacts/restore-${locale}.png`});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`artifacts/restore-mobile-${locale}.png`});
  await restoreModal.getByRole('button',{name:locale==='zh-CN'?'取消':'Cancel',exact:true}).click();await expect(restoreModal).toHaveCount(0);
  await page.setViewportSize({width:1366,height:900});
  // Synthetic metadata in the dedicated E2E directory exercises history without restoring any live data.
  const archiveRecord=(await(await page.request.get('/api/admin/backups')).json()).items[0];
  const owner=(await(await page.request.get('/api/me')).json()).id;
  const historyRoot=resolve('artifacts/e2e-data.backups/.backup-restores');await mkdir(historyRoot,{recursive:true});const paths:string[]=[];
  try {
    for(let i=0;i<25;i++){const id=randomUUID().replaceAll('-',''),started=new Date(Date.now()-i*60000).toISOString(),path=join(historyRoot,id+'.json');paths.push(path);await writeFile(path,JSON.stringify({state:{id,backupId:archiveRecord.id,status:i%2===0?'failed':'completed',updatedAt:started,safetyBackupId:archiveRecord.id,errorCode:i%2===0?'space':undefined},startedAt:started,backupCreatedAt:archiveRecord.createdAt,actorId:owner}));}
    await page.getByRole('button',{name:locale==='zh-CN'?'恢复记录':'Restore history',exact:true}).click();const historyModal=page.getByRole('dialog');
    await expect(historyModal.locator('tbody tr')).toHaveCount(20);await expect(historyModal).not.toContainText(/restore\.(history|errors|states)\./);
    await historyModal.getByRole('button',{name:locale==='zh-CN'?'下一页':'Next page',exact:true}).click();await expect(historyModal.locator('tbody tr')).toHaveCount(5);
    await historyModal.getByLabel(locale==='zh-CN'?'恢复结果':'Restore result').selectOption('failed');await expect(historyModal.locator('tbody tr')).toHaveCount(13);
    const top=historyModal.locator('tbody tr').first();await top.getByRole('button',{name:locale==='zh-CN'?'关于查看详情的说明':'Help for View details',exact:true}).click();await expect(historyModal).toContainText(locale==='zh-CN'?'可用磁盘空间不足':'not enough disk space');
    await page.screenshot({path:`artifacts/restore-history-${locale}.png`});
    const safetyDownload=page.waitForEvent('download');await top.getByRole('button',{name:locale==='zh-CN'?'下载恢复前安全备份':'Download pre-restore safety backup',exact:true}).click();expect((await safetyDownload).suggestedFilename()).toMatch(/\.zip$/);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`artifacts/restore-history-mobile-${locale}.png`});
    await historyModal.getByRole('button',{name:locale==='zh-CN'?'关闭':'Close',exact:true}).click();await expect(historyModal).toHaveCount(0);
  } finally {await Promise.all(paths.map(path=>unlink(path)));}
  await page.setViewportSize({width:1366,height:900});
  await page.screenshot({path:`artifacts/backups-${locale}.png`});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`artifacts/backups-mobile-${locale}.png`,fullPage:true});
  await row.getByRole('button',{name:locale==='zh-CN'?'删除备份':'Delete backup',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:locale==='zh-CN'?'删除备份':'Delete backup',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
});
