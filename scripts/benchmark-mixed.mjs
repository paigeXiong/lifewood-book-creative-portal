// Real API mutations in the disposable host owned by benchmark-api.mjs.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {writeFileSync, readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startResourceSampler} from './benchmark-resources.mjs';
import {createFileGrowth} from './benchmark-file-growth.mjs';

const hash=data=>createHash('sha256').update(data).digest('hex');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const round=n=>Math.round(n*100)/100;
export function screenshot(seed=123456789) {
  // Deterministic, valid RGBA PNG with about 1 MiB of incompressible image data.
  const crc=bytes=>{let n=0xffffffff;for(const byte of bytes){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(512,0);header.writeUInt32BE(512,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(512*(512*4+1));let state=seed;
  for(let y=0;y<512;y++)for(let x=1;x<=512*4;x++){state^=state<<13;state^=state>>>17;state^=state<<5;raw[y*(512*4+1)+x]=state&255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export async function runMixed({owner,customer,other,root,report,reportPath,databaseBytes,start,stop,serverPid,sustainedSeconds=0,idleSeconds=0,fileGrowth=false}) {
  delete report.samplesPerScenario;delete report.warmups;
  report.scope='Four real project write flows plus four read workers over 10,000 synthetic background projects. Default limits retained. Short loopback workload, not production capacity.';
  const samples=[], checks=[], png=screenshot();
  let sampler, mixedStarted;
  report.mixed={backgroundProjects:10000,databaseBytesBefore:databaseBytes,writerProjects:4,readWorkers:4,initialSavesPerProject:8,
    uploadBytesPerProject:png.length,uploadSha256:hash(png),samples,checks,passed:false,sustainedSeconds,saveIntervalMs:sustainedSeconds?6000:20,readIntervalMs:sustainedSeconds?100:10};
  if(sustainedSeconds) report.scope=`${sustainedSeconds}s paced loopback saves and upload replays with concurrent reads; four projects, synthetic background, Windows process resource samples. Not a capacity or leak certification.`;
  let phase='setup', activeWriters=0, writesInFlight=0, writeEpoch=0;
  const persist=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));
  const recordCheck=description=>{checks.push(description);persist();};
  persist();
  async function send(operation,client,path,method='GET',body,expected=[200],locale) {
    const headers={};
    if(locale)headers['Accept-Language']=locale;
    if(method!=='GET') headers['X-CSRF-TOKEN']=(await client.api('/api/auth/csrf')).token;
    if(body!==undefined && !(body instanceof FormData)) {headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const started=performance.now();
    const sample={operation,phase,activeWriterFlows:activeWriters,overlappedWrites:writesInFlight>0,status:null,ms:null,expected:false,offsetMs:phase==='mixed'?round(started-mixedStarted):null};
    const isMixedWrite=phase==='mixed' && method!=='GET';
    if(isMixedWrite){writesInFlight++;writeEpoch++;}
    const epochAtStart=writeEpoch;
    try {
      const response=await client.raw(path,{method,headers,body});const text=await response.text();
      sample.ms=round(performance.now()-started);sample.status=response.status;sample.expected=expected.includes(response.status);
      if(!sample.expected) {
        try {const parsed=JSON.parse(text),problem=parsed.error??parsed;sample.problem={code:problem.code,fields:problem.fields??problem.fieldErrors};} catch {}
      }
      assert(sample.expected,`${operation}: unexpected HTTP ${response.status}`);
      return {status:response.status,data:text?JSON.parse(text):null};
    } catch(error) {sample.error=error.message;throw error;}
    finally {sample.overlappedWrites ||= writeEpoch!==epochAtStart;if(isMixedWrite)writesInFlight--;sample.ms??=round(performance.now()-started);samples.push(sample);}
  }
  const upload=(version,id=randomUUID())=>{const form=new FormData();form.set('version',String(version));form.set('categoryId','book-cover');form.set('uploadId',id);form.set('file',new Blob([png],{type:'image/png'}),'混合负载-cover.png');return form;};
  const entries=[];
  const growth=fileGrowth?createFileGrowth({root,report,send,screenshot,png}):null;
  if(growth)report.fileGrowthHarnessSha256=hash(await (await import('node:fs/promises')).readFile(new URL('./benchmark-file-growth.mjs',import.meta.url)));
  try {
    for(let i=0;i<4;i++) {
      const client=i<2?customer:other,locale=i%2?'en-US':'zh-CN';
      const options=await client.api('/api/form-options?locale='+locale);
      assert(options.sourceCategories.filter(item=>item.required).every(item=>item.id==='book-cover'),'Fixture requires adapting to changed required source categories');
      let draft=(await send('create',client,'/api/projects','POST',{})).data;
      const path='/api/projects/'+draft.id;
      draft.project.videoGoalId=options.videoGoals[0].id;draft.project.audienceIds=[options.audiences[0].id];
      draft.project.projectName='混合负载 / Mixed '+i;
      Object.assign(draft.book,{title:(locale==='zh-CN'?'并发测试书籍 ':'Concurrent book ')+i,authorName:'Mixed author',genreId:options.genres[0].id,
        contentLanguageId:options.contentLanguages[0].id,videoDurationId:options.videoDurations.find(item=>!item.allowsCustomValue).id,synopsis:'Mixed workload. '.repeat(32)});
      draft=(await send('prepare-book',client,path+'/draft','PUT',{version:draft.version,project:draft.project,book:draft.book})).data;
      draft.creative.characters=[{id:'mixed-character',roleTypeId:options.roleTypes[0].id,name:'角色 / Mara',storyRole:'Lead',personality:'Curious',appearance:'Traveler',referenceImageUrls:[],referenceImages:[]}];
      draft.creative.visualStyleId=options.visualStyles[0].id;
      draft=(await send('prepare-creative',client,path+'/creative','PUT',{version:draft.version,creative:draft.creative})).data;
      draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};draft.voiceAndReferences.creativeDirection.coreMessage='Keep concurrent changes intact.';
      draft=(await send('prepare-voice',client,path+'/voice-and-references','PUT',{version:draft.version,voiceAndReferences:draft.voiceAndReferences})).data;
      entries.push({client,locale,path,draft,saves:0,uploadReplays:0});
      growth?.register(entries.at(-1),i,options);
    }
    // Warm the read paths before the measured mixed phase.
    for(const client of [customer,other]) {await client.api('/api/projects?pageSize=20');await client.api('/api/projects/stats');}
    await owner.api('/api/admin/projects?pageSize=20');
    if(sustainedSeconds) {
      report.resourceHarnessSha256=hash(await (await import('node:fs/promises')).readFile(new URL('./benchmark-resources.mjs',import.meta.url)));
      sampler=await startResourceSampler(serverPid,root);report.resources=sampler.report;
    }
    phase='mixed';activeWriters=entries.length;
    mixedStarted=performance.now();
    const deadline=mixedStarted+sustainedSeconds*1000;
    async function writer(entry,index) {
      try {
        await delay(index*25);
        for(let i=0;i<8;i++) {
          const previous=entry.draft;
          entry.draft=(await send('save',entry.client,entry.path+'/draft','PUT',{version:previous.version,project:previous.project,book:{...previous.book,sellingPoint:`Writer ${index} save ${i}`}})).data;
          assert.equal(entry.draft.version,previous.version+1);entry.saves++;
          await delay(20);
        }
        const version=entry.draft.version,uploadId=randomUUID();
        const result=(await send('upload',entry.client,entry.path+'/files?categoryId=book-cover','POST',upload(version,uploadId))).data;
        assert.equal(result.draft.version,version+1);entry.draft=result.draft;entry.asset=result.asset;
        growth?.coverReady(entry);
        // Replaying the same ID and bytes must survive a stale version without duplicating the file.
        const replay=(await send('upload-replay',entry.client,entry.path+'/files?categoryId=book-cover','POST',upload(version,uploadId))).data;
        entry.uploadReplays++;assert.equal(replay.asset.id,result.asset.id);assert.equal(replay.draft.version,result.draft.version);
        assert.equal(replay.draft.book.sourceAssets.filter(asset=>asset.id===result.asset.id).length,1);
        if(sustainedSeconds) {
          let iteration=0;
          while(performance.now()<deadline) {
            const previous=entry.draft;
            entry.lastSellingPoint=`Writer ${index} sustained ${iteration}`;
            entry.draft=(await send('save',entry.client,entry.path+'/draft','PUT',{version:previous.version,project:previous.project,book:{...previous.book,sellingPoint:entry.lastSellingPoint}})).data;
            assert.equal(entry.draft.version,previous.version+1);entry.saves++;
            if(iteration%10===0) {
              const repeated=(await send('upload-replay',entry.client,entry.path+'/files?categoryId=book-cover','POST',upload(version,uploadId))).data;
              entry.uploadReplays++;assert.equal(repeated.asset.id,entry.asset.id);assert.equal(repeated.draft.version,entry.draft.version);
              assert.equal(repeated.draft.book.sourceAssets.length,growth?growth.assets(entry).length:1);
            }
            if(growth && iteration%5===0)await growth.appendNext(entry);
            iteration++;await delay(Math.max(0,Math.min(6000,deadline-performance.now())));
          }
        }
        if(growth)await growth.verifyLimitAndReplace(entry);
        const validation=(await send('validate',entry.client,entry.path+'/validate','POST',{version:entry.draft.version})).data;
        assert.equal(validation.valid,true,'The real submit validator must accept the project');
        const request={version:entry.draft.version,idempotencyKey:randomUUID().replaceAll('-','')};
        await send('submit',entry.client,entry.path+'/submit','POST',request);
        await send('submit-replay',entry.client,entry.path+'/submit','POST',request);
        entry.submitted=(await send('verify-submission',entry.client,entry.path)).data;
        assert.equal(entry.submitted.status,'submitted');assert.equal(entry.submitted.version,request.version+1);
        assert.equal(entry.submitted.book.sellingPoint,entry.lastSellingPoint??`Writer ${index} save 7`);
      } finally {activeWriters--;}
    }
    async function reader(worker) {
      const client=worker===3?owner:worker===1?other:customer;
      const path=worker===3?'/api/admin/projects?pageSize=20':worker===2?'/api/projects/stats':'/api/projects?pageSize=20';
      for(let i=0;i<100 || (sustainedSeconds && activeWriters>0);i++) {
        const value=(await send(worker===3?'admin-read':worker===2?'stats-read':'customer-read',client,path)).data;
        if(worker===3) {
          assert(value.total>=9980 && value.total<=9984);assert.equal(value.items.length,20);
        } else {
          assert.equal(value.total,client===customer?9002:1002);
          if(worker===2) assert.equal(value.drafts+value.active+value.completed,value.total);
          else {
            assert.equal(value.items.length,20);
            const owned=new Set(entries.filter(entry=>entry.client===client).map(entry=>entry.draft.id));
            for(const item of value.items) {
              if(owned.has(item.id))continue;
              assert(/^b[0-9]{31}$/.test(item.id),'Unexpected project ID in customer list');
              assert.equal(Number(item.id.slice(1))%10===0,client===other,'Customer list ownership mismatch');
            }
          }
        }
        await delay(sustainedSeconds?100:10);
      }
    }
    const completed=await Promise.allSettled([...entries.map(writer),...Array.from({length:4},(_,i)=>reader(i))]);
    report.mixed.durationMs=round(performance.now()-mixedStarted);
    for(const result of completed)if(result.status==='rejected')throw result.reason;
    if(sampler && idleSeconds) {
      // All HTTP workers have settled. Keep sampling this same process without requests or forced GC.
      phase='idle';
      const idleStarted=performance.now();
      const idle=report.idle={configuredSeconds:idleSeconds,startedAt:new Date().toISOString(),resourceSampleStartIndex:sampler.report.samples.length};
      persist();console.log(`Load complete; observing ${idleSeconds}s idle / 负载完成，观察空闲回落`);
      await delay(idleSeconds*1000);
      idle.durationMs=round(performance.now()-idleStarted);
      idle.resourceSampleEndIndex=sampler.report.samples.length;
      idle.finishedAt=new Date().toISOString();
      assert(idle.resourceSampleEndIndex-idle.resourceSampleStartIndex>=Math.max(2,Math.floor(idleSeconds*.8)), 'Insufficient idle samples');
    }
    if(sampler) {await sampler.stop();sampler=null;persist();}
    report.mixed.perProject=entries.map(entry=>({id:entry.draft.id,locale:entry.locale,saves:entry.saves,uploadReplays:entry.uploadReplays}));
    phase='verification';
    assert.equal((await send('final-admin-read',owner,'/api/admin/projects?pageSize=20')).data.total,9984);
    recordCheck('Four write flows and four read workers completed; latest saves survived submission');
    recordCheck('Same upload ID/bytes reused one file; same submit key incremented version once');

    phase='conflict-check';
    const probe=(await send('conflict-create',customer,'/api/projects','POST',{})).data,path='/api/projects/'+probe.id;
    const attempts=['A','B'].map(value=>({version:probe.version,project:probe.project,book:{...probe.book,title:'Conflict '+value}}));
    const races=await Promise.all(attempts.map(body=>send('save-race',customer,path+'/draft','PUT',body,[200,409])));
    assert.deepEqual(races.map(item=>item.status).sort(),[200,409]);
    let current=(await send('read-conflict',customer,path)).data;
    assert.equal(current.version,probe.version+1);assert.equal(current.book.title,attempts[races.findIndex(item=>item.status===200)].book.title);
    await send('stale-upload',customer,path+'/files?categoryId=book-cover','POST',upload(probe.version),[409]);
    const retry={...attempts[races.findIndex(item=>item.status===409)],version:current.version};
    current=(await send('save-after-reload',customer,path+'/draft','PUT',retry)).data;
    assert.equal(current.version,probe.version+2);assert.equal(current.book.title,retry.book.title);assert.equal(current.book.sourceAssets.length,0);
    await send('delete-conflict-probe',customer,path+'?version='+current.version,'DELETE',undefined,[204]);
    await send('foreign-read',other,entries[0].path,'GET',undefined,[404]);
    await send('foreign-upload',other,entries[0].path+'/files?categoryId=book-cover','POST',upload(1),[404]);
    recordCheck('Same-version saves produced exactly one success and one conflict; reload/retry preserved the chosen value');
    recordCheck('Stale upload rejected without metadata; another customer cannot read or upload to this project');

    async function verifyDurable() {
      for(const entry of entries) {
        const saved=await entry.client.api(entry.path);
        assert.deepEqual(saved,entry.submitted);
        growth?.verifyMetadata(entry,saved);
        for(const asset of growth?growth.assets(entry):[{...entry.asset,sha256:hash(png)}]) {
          const response=await entry.client.raw(asset.url);assert(response.ok);
          assert.equal(hash(Buffer.from(await response.arrayBuffer())),asset.sha256);
        }
        growth?.verifyDisk(entry,'durability');
      }
      const uploads=join(root,'data/uploads');
      const expectedFiles=growth?entries.reduce((sum,entry)=>sum+growth.assets(entry).length,0):4;
      assert(existsSync(uploads));assert.equal(readdirSync(uploads,{recursive:true,withFileTypes:true}).filter(item=>item.isFile()).length,expectedFiles,'No duplicate or orphan upload files');
    }
    await verifyDurable();
    phase='restart-check';await stop();
    const db=new DatabaseSync(join(root,'data/platform.db'),{readOnly:true});
    try {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      for(const entry of entries) {
        const row=db.prepare('SELECT submission_snapshot_json,submission_key FROM projects WHERE id=?').get(entry.draft.id);
        assert(row.submission_snapshot_json && row.submission_key,'Submitted snapshot and key must be persisted');
      }
    } finally {db.close();}
    await start();await verifyDurable();
    recordCheck('Database integrity passed; submitted data and all expected file hashes survived a service restart without duplicate/orphan uploads');
    if(growth)growth.finish();
    const groups=new Map();
    const timing=list=>{
      const times=list.map(item=>item.ms).sort((a,b)=>a-b);
      return {samples:times.length,p50Ms:times.length?times[Math.ceil(times.length*.5)-1]:null,
        p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,maxMs:times.length?times.at(-1):null};
    };
    for(const sample of samples.filter(item=>item.phase==='mixed')) {const list=groups.get(sample.operation)??[];list.push(sample);groups.set(sample.operation,list);}
    report.mixed.results=[...groups].map(([operation,list])=>({operation,...timing(list),
      duringActiveWriteFlows:timing(list.filter(item=>item.activeWriterFlows>0)),
      overlappingWriteRequests:timing(list.filter(item=>item.overlappedWrites)),
      unexpected:list.filter(item=>!item.expected).length}));
    for(const operation of ['customer-read','stats-read','admin-read'])
      assert(report.mixed.results.find(item=>item.operation===operation).overlappingWriteRequests.samples>0,'Read workload did not overlap any writes');
    report.mixed.windows=Array.from({length:Math.ceil(report.mixed.durationMs/30000)},(_,index)=>{
      const windowSamples=samples.filter(item=>item.phase==='mixed' && item.offsetMs>=index*30000 && item.offsetMs<(index+1)*30000);
      return {fromSeconds:index*30,toSeconds:Math.min((index+1)*30,report.mixed.durationMs/1000),operations:[...new Set(windowSamples.map(item=>item.operation))].map(operation=>({operation,...timing(windowSamples.filter(item=>item.operation===operation))}))};
    });
    report.mixed.expectedRejections=samples.filter(item=>item.status>=400&&item.expected).map(item=>({operation:item.operation,status:item.status}));
    assert(samples.every(item=>item.expected));report.mixed.passed=true;persist();
    console.log(JSON.stringify({mixed:report.mixed.results,checks,reportPath}));
  } finally {try {if(sampler)await sampler.stop();} finally {persist();}}
}
