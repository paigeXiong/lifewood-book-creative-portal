import { postAuthentication } from "./auth-request";
import {expect, test} from '@playwright/test';

test('task columns and toolbar stay aligned across filters and loading', async ({page}) => {
  test.setTimeout(90000);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()).token;
  const status = await (await page.request.get('/api/auth/status')).json();
  const auth = await postAuthentication(page.request, status.requiresBootstrap ? '/api/auth/bootstrap' : '/api/auth/login', {
    headers: {'X-CSRF-TOKEN': csrf},
    data: status.requiresBootstrap ? {displayName:'E2E Owner', email:'owner.e2e@lifewood.test', password:'E2E-owner-password-2026', organizationName:'E2E'} : {email:'owner.e2e@lifewood.test',password:'E2E-owner-password-2026',rememberMe:false}
  });
  expect(auth.ok()).toBeTruthy();
  await page.route('**/api/projects?*', async route => {
    const filtered = new URL(route.request().url()).searchParams.has('status');
    await new Promise(resolve => setTimeout(resolve, 250));
    const items = Array.from({length: filtered ? 1 : 10}, (_, i) => ({
      id: `layout-${i}`, version: 1, status:'submitted', workflowStatus:'new',
      projectName: filtered ? 'Short' : 'A very long project title with different content',
      bookTitle: filtered ? 'Short' : 'A very long project title with different content',
      authorName: filtered ? 'A' : 'Author with a much longer display name', clientName:'Client',
      createdAt:'2026-09-01T00:00:00Z', updatedAt:'2026-09-01T00:00:00Z'
    }));
    await route.fulfill({json:{items,total:items.length,page:1,pageSize:10}});
  });
  const geometry = () => page.locator('.task-table th, .task-search, .task-filter-button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return {x:r.x, width:r.width};
  }));
  for (const locale of ['zh-CN','en-US']) {
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`http://127.0.0.1:5193/${locale}/tasks`);
    await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
    const before = await geometry();
    await page.locator('.task-attention-tabs button').nth(1).click();
    await expect(page.locator('.task-loading-row')).toHaveCount(4);
    expect(await geometry()).toEqual(before);
    await expect(page.locator('.task-table tbody tr')).toHaveCount(1);
    expect(await geometry()).toEqual(before);
    await page.screenshot({path:`artifacts/task-columns-${locale}.png`});
    await page.locator('.task-attention-tabs button').first().click();
    await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
    expect(await geometry()).toEqual(before);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});
