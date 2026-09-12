// Real, disposable business data used by installer lifecycle tests. Never use live accounts.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, realpath, lstat} from 'node:fs/promises';
import {resolve, dirname, sep} from 'node:path';

const [mode, address, statePath] = process.argv.slice(2);
assert(['seed', 'verify'].includes(mode), 'Expected seed or verify');
assert.equal(process.env.LIFEWOOD_INSTALLER_FIXTURE, '1', 'Explicit fixture opt-in is required');
const base = new URL(address);
assert(base.protocol === 'http:' && base.hostname === '127.0.0.1' && base.port === '5098' && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password,
  'The fixture only supports the dedicated loopback port 5098');
const root = resolve(import.meta.dirname, '../artifacts/installer-lifecycle');
const file = resolve(statePath);
assert(file.startsWith(root + sep), 'Fixture credentials must remain in ignored installer artifacts');
await mkdir(dirname(file), {recursive:true});
assert((await realpath(root)).toLowerCase() === root.toLowerCase(), 'Fixture root must not be a link');
assert((await realpath(dirname(file))).startsWith((await realpath(root)) + sep), 'Fixture directory must not escape through a link');
try { assert(!(await lstat(file)).isSymbolicLink(), 'Fixture state cannot be a link'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
function video() {
  const u32 = n => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(n); return bytes; };
  const box = (name, ...parts) => { const bytes = Buffer.concat(parts); return Buffer.concat([u32(bytes.length + 8), Buffer.from(name), bytes]); };
  const table = box('stbl', box('stsd', u32(0), u32(1), box('avc1')), box('stsz', u32(0), u32(1), u32(1)));
  return Buffer.concat([box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom')), box('mdat', Buffer.from([1])),
    box('moov', box('trak', box('mdia', box('hdlr', Buffer.alloc(8), Buffer.from('vide')), box('minf', table))))]);
}
function client() {
  const cookies = new Map();
  const raw = async (path, options = {}) => {
    assert(path.startsWith('/') && !path.startsWith('//'), 'Expected a local API path');
    const headers = new Headers(options.headers);
    headers.set('Cookie', [...cookies].map(([key,value]) => key + '=' + value).join('; '));
    const response = await fetch(base.origin + path, {...options, headers, redirect:'error', signal:AbortSignal.timeout(60000)});
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(';', 1)[0], index = pair.indexOf('=');
      cookies.set(pair.slice(0,index), pair.slice(index+1));
    }
    return response;
  };
  const api = async (path, method = 'GET', body) => {
    const headers = {};
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = (await (await raw('/api/auth/csrf')).json()).token;
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await raw(path, {method, headers, body});
    assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const login = async (email, password) => {
    // The lifecycle logs in several times without resetting real security controls.
    for (let attempt=0; attempt<4; attempt++) {
      const token = (await api('/api/auth/csrf')).token;
      const response = await raw('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-TOKEN':token}, body:JSON.stringify({email,password,rememberMe:false})});
      if (response.status !== 429) { assert(response.ok, 'Fixture login failed: HTTP ' + response.status); return; }
      const seconds = Number(response.headers.get('Retry-After'));
      assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, 'Unexpected login retry window');
      await delay(seconds * 1000);
    }
    throw new Error('Fixture login remained rate limited');
  };
  const digest = async path => { const response = await raw(path); assert(response.ok, 'Download failed: ' + path); return hash(Buffer.from(await response.arrayBuffer())); };
  return {raw, api, login, digest};
}
const owner = client(), customer = client();
let state;
if (mode === 'seed') {
  assert.equal((await owner.api('/api/auth/status')).requiresBootstrap, true, 'Refusing to seed an initialized server');
  state = {base:base.origin, password:'Installer-' + randomUUID(), ownerEmail:'owner@installer.test', customerEmail:'customer@installer.test', assets:[]};
  await owner.api('/api/auth/bootstrap', 'POST', {displayName:'Installer owner', email:state.ownerEmail, password:state.password, organizationName:'Installer owner organization'});
  state.ownerId = (await owner.api('/api/me')).id;
  const organization = await owner.api('/api/admin/organizations', 'POST', {name:'安装升级 / Installer organization'});
  state.organizationId = organization.id;
  await owner.api('/api/admin/users', 'POST', {displayName:'Installer customer', email:state.customerEmail, password:state.password, role:'customer', organizationId:organization.id});
  await customer.login(state.customerEmail, state.password);
  state.customerId = (await customer.api('/api/me')).id;
  const options = await customer.api('/api/form-options?locale=en-US');
  let draft = await customer.api('/api/projects', 'POST', {});
  const projectPath = '/api/projects/' + draft.id;
  draft.project.videoGoalId = options.videoGoals[0].id;
  draft.project.audienceIds = [options.audiences[0].id];
  Object.assign(draft.book, {title:'升级保留 / Preserved project', authorName:'Installer author', genreId:options.genres[0].id,
    contentLanguageId:options.contentLanguages[0].id, videoDurationId:options.videoDurations.find(item => !item.allowsCustomValue).id});
  draft = await customer.api(projectPath + '/draft', 'PUT', {version:draft.version, project:draft.project, book:draft.book});
  draft.creative.characters = [{id:'installer-character', roleTypeId:options.roleTypes[0].id, name:'Mara', storyRole:'Lead', personality:'Curious', appearance:'Traveler', referenceImageUrls:[], referenceImages:[]}];
  draft.creative.visualStyleId = options.visualStyles[0].id;
  draft = await customer.api(projectPath + '/creative', 'PUT', {version:draft.version, creative:draft.creative});
  draft.voiceAndReferences.voiceover = {narrationEnabled:false, selectedVoiceIds:[]};
  draft.voiceAndReferences.creativeDirection.coreMessage = 'Preserve every submitted detail.';
  draft = await customer.api(projectPath + '/voice-and-references', 'PUT', {version:draft.version, voiceAndReferences:draft.voiceAndReferences});
  for (const category of options.sourceCategories.filter(item => item.required)) {
    const image = category.accept.includes('image/png');
    assert(image || category.accept.includes('application/pdf'), 'Unsupported required fixture category');
    const bytes = image ? png : pdf;
    const form = new FormData();
    form.set('version', String(draft.version)); form.set('categoryId', category.id);
    form.set('file', new Blob([bytes], {type:image ? 'image/png' : 'application/pdf'}), image ? 'cover.png' : 'manuscript.pdf');
    const uploaded = await customer.api(projectPath + '/files?categoryId=' + encodeURIComponent(category.id), 'POST', form);
    draft = uploaded.draft; state.assets.push({url:uploaded.asset.url, hash:hash(bytes)});
  }
  const validation = await customer.api(projectPath + '/validate', 'POST', {version:draft.version});
  assert.equal(validation.valid, true, 'Fixture project must be valid');
  await customer.api(projectPath + '/submit', 'POST', {version:draft.version, idempotencyKey:randomUUID().replaceAll('-','')});
  state.project = await customer.api(projectPath);
  const form = new FormData();
  form.set('file', new Blob([video()], {type:'video/mp4'}), 'final.mp4'); form.set('note', '成品保留 / Preserved delivery');
  const delivery = await owner.api('/api/admin/projects/' + draft.id + '/deliveries', 'POST', form);
  state.delivery = {id:delivery.id, hash:hash(video()), note:delivery.note};
  state.feedbackId = randomUUID().replaceAll('-','');
  await customer.api('/api/feedback', 'POST', {id:state.feedbackId, category:'bug', description:'安装升级反馈 / Installer feedback <b>plain text</b>', pagePath:'/zh-CN/profile', screenshotBase64:png.toString('base64'), screenshotType:'image/png'});
  const feedback = await owner.api('/api/admin/feedback/' + state.feedbackId);
  await owner.api('/api/admin/feedback/' + state.feedbackId, 'PUT', {version:feedback.item.version, status:'resolved', reply:'已处理 / Resolved during fixture setup'});
  state.feedback = await owner.api('/api/admin/feedback/' + state.feedbackId);
  for (let attempt=0; attempt<120; attempt++) {
    const notices = await customer.api('/api/notifications?kind=feedback_reply');
    const item = notices.items[0];
    if (item) { state.noticeId = item.id; state.notice = await customer.api('/api/notifications/' + item.id + '/feedback'); break; }
    await delay(500);
  }
  assert(state.noticeId, 'Feedback reply notification was not delivered');
  await owner.api('/api/admin/notifications/retention', 'PUT', {days:233});
  await customer.api('/api/notifications/preferences', 'PUT', {toast:false, sound:false, quietStart:null, quietEnd:null, timeZone:'UTC', mutedKinds:[]});
  const job = await owner.api('/api/admin/backups', 'POST', {});
  for (let attempt=0; attempt<120; attempt++) {
    const overview = await owner.api('/api/admin/backups');
    const record = overview.items.find(item => item.id === job.id);
    if (record?.status === 'completed' && record.verificationStatus === 'passed' && !overview.current) { state.backupId = record.id; break; }
    assert(record?.status !== 'failed', 'Fixture backup failed');
    await delay(500);
  }
  assert(state.backupId, 'Backup completion timeout');
  state.backupHash = await owner.digest('/api/admin/backups/' + state.backupId + '/download');
  // Private fixture credentials and snapshot are intentionally excluded from CI artifact upload.
  await writeFile(file, JSON.stringify(state, null, 2), {flag:'wx', mode:0o600});
} else {
  state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.base, base.origin);
  await owner.login(state.ownerEmail, state.password);
  await customer.login(state.customerEmail, state.password);
}
assert.equal((await owner.api('/api/me')).id, state.ownerId);
const me = await customer.api('/api/me');
assert.equal(me.id, state.customerId); assert.equal(me.organization.id, state.organizationId);
assert.equal(me.organization.name, '安装升级 / Installer organization');
const saved = await customer.api('/api/projects/' + state.project.id);
for (const key of ['id', 'version', 'status', 'project', 'book', 'creative', 'voiceAndReferences']) assert.deepEqual(saved[key], state.project[key], 'Project field changed: ' + key);
for (const asset of state.assets) assert.equal(await customer.digest(asset.url), asset.hash, 'Attachment bytes changed');
const deliveries = await customer.api('/api/projects/' + saved.id + '/deliveries');
assert.equal(deliveries.length, 1); assert.equal(deliveries[0].id, state.delivery.id); assert.equal(deliveries[0].note, state.delivery.note);
assert.equal(await customer.digest('/api/projects/' + saved.id + '/deliveries/' + state.delivery.id + '/file'), state.delivery.hash);
assert.deepEqual(await owner.api('/api/admin/feedback/' + state.feedbackId), state.feedback);
assert.deepEqual(await customer.api('/api/notifications/' + state.noticeId + '/feedback'), state.notice);
assert.equal(await owner.digest('/api/admin/feedback/' + state.feedbackId + '/screenshot'), hash(png));
assert.equal((await owner.api('/api/admin/notifications/rules')).retentionDays, 233);
assert.equal((await customer.api('/api/notifications/preferences')).toast, false);
assert.equal(await owner.digest('/api/admin/backups/' + state.backupId + '/download'), state.backupHash);
for (const locale of ['zh-CN', 'en-US']) {
  const catalog = await customer.api('/api/feedback/catalog?locale=' + locale);
  assert.equal(catalog.categories[0].label, locale === 'zh-CN' ? '平台问题' : 'Platform issue');
  for (const prefix of ['', '/admin']) {
    const response = await customer.raw(prefix + '/' + locale + (prefix ? '/projects' : '/tasks'));
    assert(response.ok && response.headers.get('Content-Type')?.includes('text/html'), 'Packaged frontend is unavailable');
    assert.match(await response.text(), /<script[^>]+src=/);
  }
}
console.log(JSON.stringify({passed:true, mode, checks:['account credentials and identity', 'organization', 'submitted project fields and version', 'attachment SHA-256', 'final delivery SHA-256', 'feedback reply notification and screenshot', 'notification preferences', 'backup SHA-256', 'Chinese and English API labels and packaged frontend routes']}));
