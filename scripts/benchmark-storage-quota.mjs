// Bounded API quota/recovery acceptance against the harness-owned disposable host.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readdirSync,statSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {screenshot} from './benchmark-mixed.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function files(directory) {
  if(!existsSync(directory))return [];
  return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{
    assert(!item.isSymbolicLink(),'Disposable data must not contain links');
    const path=join(directory,item.name);return item.isDirectory()?files(path):[path];
  });
}
export async function runStorageQuota({customer,other,root,report,reportPath,start,stop}) {
  delete report.samplesPerScenario;delete report.warmups;
  report.scope='Isolated, explicitly reduced storage quota; real project attachments, concurrent admission, localized error contract, deletion and retry. Not physical disk exhaustion or a load test.';
  const result=report.storageQuota={samples:[],checks:[],disk:[],passed:false};
  const persist=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));
  const check=name=>{result.checks.push(name);persist();};
  const entries=[];
  const retained=new Map();
  async function request(entry,name,path,method='GET',body,expected=[200],csrf) {
    const headers={'Accept-Language':entry.locale};
    if(method!=='GET')headers['X-CSRF-TOKEN']=csrf??(await entry.client.api('/api/auth/csrf')).token;
    const startedMs=performance.now();
    const response=await entry.client.raw(path,{method,headers,body});
    const text=await response.text();
    const endedMs=performance.now();
    result.samples.push({name,locale:entry.locale,status:response.status,startedMs,endedMs});persist();
    assert(expected.includes(response.status),`${name}: unexpected HTTP ${response.status}`);
    return {status:response.status,data:text?JSON.parse(text):null,startedMs,endedMs};
  }
  const upload=(entry,pending,expected=[200],csrf)=>{
    const form=new FormData();form.set('version',String(pending.version));form.set('categoryId','supplemental-images');form.set('uploadId',pending.id);
    form.set('file',new Blob([pending.bytes],{type:'image/png'}),pending.name);
    return request(entry,'upload',entry.path+'/files?categoryId=supplemental-images','POST',form,expected,csrf);
  };
  function remember(entry,pending,data) {
    assert.equal(data.draft.version,pending.version+1);entry.draft=data.draft;
    retained.set(data.asset.id,{entry,asset:data.asset,sha256:hash(pending.bytes)});
    return data.asset;
  }
  function quotaError(response) {
    assert.equal(response.status,507);
    const error=response.data.error??response.data;
    assert.equal(error.code,'storage.quota');assert.equal(error.messageKey,'errors.storage.quota');assert.equal(error.retryable,true);
  }
  async function verify(label) {
    for(const entry of entries) {
      const before=await entry.client.api(entry.path);
      assert.equal(before.version,entry.draft.version);
      const expected=[...retained.values()].filter(item=>item.entry===entry).map(item=>item.asset).sort((a,b)=>a.id.localeCompare(b.id));
      assert.deepEqual([...before.book.sourceAssets].sort((a,b)=>a.id.localeCompare(b.id)),expected);
    }
    const paths=files(join(root,'data/uploads'));assert.equal(paths.length,retained.size,'Duplicate, staged or orphan upload file');
    for(const {entry,asset,sha256} of retained.values()) {
      const path=paths.find(path=>basename(path)===asset.id+'_'+asset.fileName);assert(path);
      assert.equal(statSync(path).size,asset.sizeBytes);assert.equal(hash(readFileSync(path)),sha256);
      const response=await entry.client.raw(asset.url);assert.equal(response.status,200);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())),sha256);
    }
    result.disk.push({label,files:paths.length,uploadBytes:paths.reduce((sum,path)=>sum+statSync(path).size,0)});persist();
  }
  for(const [client,locale] of [[customer,'zh-CN'],[other,'en-US']]) {
    const options=await client.api('/api/form-options?locale='+locale);
    const category=options.sourceCategories.find(item=>item.id==='supplemental-images');
    assert(category?.maxFiles>=3 && category.accept.includes('image/png'));
    const draft=await client.api('/api/projects','POST',{});
    entries.push({client,locale,draft,path:'/api/projects/'+draft.id});
  }
  const png=screenshot(), initial={id:randomUUID(),version:entries[0].draft.version,bytes:png,name:'空间验证.png'};
  await stop();
  const baseline=files(join(root,'data')).filter(path=>basename(path).toLowerCase()!=='platform.lock').reduce((sum,path)=>sum+statSync(path).size,0);
  // Room for two images and a bounded database/journal allowance, never for three images.
  result.baselineBytes=baseline;result.fileBytes=png.length;result.databaseAllowanceBytes=512*1024;
  result.quotaBytes=baseline+png.length*2+result.databaseAllowanceBytes;
  await start({quotaBytes:result.quotaBytes});
  const first=remember(entries[0],initial,(await upload(entries[0],initial)).data);
  const pending=entries.map((entry,i)=>({id:randomUUID(),version:entry.draft.version,bytes:screenshot(2345+i),name:i?'quota-retry.png':'空间重试.png'}));
  const beforeRace=await Promise.all(entries.map(entry=>entry.client.api(entry.path)));
  const tokens=await Promise.all(entries.map(entry=>entry.client.api('/api/auth/csrf')));
  const raced=await Promise.allSettled(entries.map((entry,i)=>upload(entry,pending[i],[200,507],tokens[i].token)));
  for(const item of raced)assert.equal(item.status,'fulfilled',item.reason?.message);
  const outcomes=raced.map(item=>item.value);assert.deepEqual(outcomes.map(item=>item.status).sort(),[200,507]);
  result.clientRequestOverlapMs=Math.min(...outcomes.map(item=>item.endedMs))-Math.max(...outcomes.map(item=>item.startedMs));
  assert(result.clientRequestOverlapMs>0,'Quota race HTTP request intervals did not overlap');
  const winner=outcomes.findIndex(item=>item.status===200), loser=1-winner;
  assert.deepEqual(await entries[loser].client.api(entries[loser].path),beforeRace[loser],'The first quota rejection changed the project snapshot');
  const removable=remember(entries[winner],pending[winner],outcomes[winner].data);quotaError(outcomes[loser]);
  result.raceStatuses=outcomes.map(item=>item.status);check('Two concurrent project uploads compete for one remaining file slot: one 200, one 507');
  await verify('full');
  async function deniedBoth(label) {
    for(let i=0;i<entries.length;i++) {
      const entry=entries[i],before=await entry.client.api(entry.path);
      // The losing upload keeps its original ID and version for the later recovery attempt.
      const attempt=i===loser?pending[i]:{...pending[i],id:randomUUID(),version:entry.draft.version};
      quotaError(await upload(entry,attempt,[507]));
      assert.deepEqual(await entry.client.api(entry.path),before);
    }
    await verify(label);
  }
  await deniedBoth('rejected-both-locales');
  const replay=await upload(entries[0],initial);assert.equal(replay.data.asset.id,first.id);assert.equal(replay.data.draft.version,entries[0].draft.version);
  await verify('replay-at-full');check('507 returns the stable i18n error key without changing drafts or files; existing upload replay and download still work');
  await stop();await start();await deniedBoth('full-after-restart');check('Quota still rejects new uploads after restarting with the same data and limit');
  const entry=entries[winner],version=entry.draft.version;
  entry.draft=(await request(entry,'delete-to-free-space',entry.path+'/files/'+removable.id+'?version='+version,'DELETE')).data;
  assert.equal(entry.draft.version,version+1);retained.delete(removable.id);
  const removed=await entry.client.raw(removable.url);assert.equal(removed.status,404);await removed.arrayBuffer();
  await verify('space-freed');
  const recovered=remember(entries[loser],pending[loser],(await upload(entries[loser],pending[loser])).data);
  const recoveredReplay=await upload(entries[loser],pending[loser]);assert.equal(recoveredReplay.data.asset.id,recovered.id);assert.equal(recoveredReplay.data.draft.version,entries[loser].draft.version);
  await verify('retry-recovered');check('Deleting an unsubmitted attachment releases space; the rejected upload succeeds with its original ID and version, and replay stays idempotent');
  await stop();await start();await verify('recovered-after-restart');
  const finalReplay=await upload(entries[loser],pending[loser]);assert.equal(finalReplay.data.asset.id,recovered.id);assert.equal(finalReplay.data.draft.version,entries[loser].draft.version);
  await verify('final-replay');check('Recovered metadata and every attachment hash survive restart');
  result.passed=true;persist();
}
