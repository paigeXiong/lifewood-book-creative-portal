// Disposable loopback-only benchmark. Never accepts a server URL or live data directory.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync, openSync, closeSync, writeFileSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {cpus, platform, release} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

const workspace = resolve(import.meta.dirname, '..');
const args=process.argv.slice(2);
const sustained=args.includes('--sustained');
const secondsArg=args.find(value=>value.startsWith('--seconds='));
const sustainedSeconds=secondsArg?Number(secondsArg.slice(10)):180;
assert(!secondsArg || sustained, '--seconds requires --sustained');
assert(Number.isInteger(sustainedSeconds) && sustainedSeconds>=10 && sustainedSeconds<=1800, 'Duration must be 10–1800 seconds');
assert(!sustained || platform()==='win32', 'Resource sampling currently requires Windows');
const mixed=sustained || args.includes('--mixed');
const files=args.filter(value=>!['--mixed','--sustained',secondsArg].includes(value));
assert(files.length<=1 && files.every(value=>!value.startsWith('--')), 'Expected an optional DLL path, --mixed or --sustained, and optional --seconds=N');
const dll = resolve(files[0] ?? join(workspace, 'services/platform-api/bin/Release/net10.0/Lifewood.BookPortal.Server.dll'));
assert(statSync(dll).isFile(), 'Build the Release backend first / 请先构建 Release 后端');
const root = join(workspace, 'artifacts/api-benchmark', randomUUID());
mkdirSync(root, {recursive:true});
assert.equal(realpathSync(root).toLowerCase(), root.toLowerCase(), 'Benchmark directory must not be a link');
const base = 'http://127.0.0.1:5097';
const probe = createServer();
await new Promise((done, fail) => {probe.once('error', fail); probe.listen(5097, '127.0.0.1', done);});
await new Promise(done => probe.close(done));
const delay = ms => new Promise(done => setTimeout(done, ms));
const childEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(Lifewood|Network|Kestrel|Logging|AllowedHosts)(:|__|$)|^ASPNETCORE_|^(DOTNET_)?URLS$/i).test(key)));
let child, launchError;
let stopping;
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]]) process.once(signal,()=>{void stop().finally(()=>process.exit(code));});
async function start() {
  const fd = openSync(join(root, 'server.log'), 'a');
  child = spawn('dotnet', [dll, '--urls='+base, '--Lifewood:DataDirectory='+join(root,'data'),
    '--Lifewood:CoordinationDirectory='+join(root,'coordination'), '--Lifewood:BackupDirectory='+join(root,'backups'), '--Lifewood:RequireWebAssets=false',
    '--Logging:LogLevel:Default=Warning'], {cwd:root, env:{...childEnvironment, ASPNETCORE_ENVIRONMENT:'Production'}, windowsHide:true, stdio:['ignore',fd,fd]});
  closeSync(fd); launchError = null; child.once('error', error => {launchError=error;});
  for(let i=0;i<120;i++) {
    if(launchError) throw launchError;
    assert(child.exitCode===null, 'Benchmark server exited; inspect '+root);
    try {if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok) return;} catch {}
    await delay(500);
  }
  throw new Error('Benchmark startup timed out');
}
async function stop() {
  if(stopping) return stopping;
  const processToStop=child;
  stopping=(async()=>{
    if(processToStop?.pid && processToStop.exitCode===null && processToStop.signalCode===null) {
      const exited=once(processToStop,'exit'); processToStop.kill(); await exited;
    }
    child=null;
  })();
  try {await stopping;} finally {stopping=null;}
}

function client() {
  const cookies=new Map();
  const raw=async(path, options={})=>{
    assert(path.startsWith('/api/') && !path.includes('://'));
    const headers=new Headers(options.headers);
    headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));
    const response=await fetch(base+path,{...options,headers,redirect:'error',signal:AbortSignal.timeout(15000)});
    for(const value of response.headers.getSetCookie()) {const pair=value.split(';',1)[0], at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
    return response;
  };
  const api=async(path, method='GET', body)=>{
    const headers={};
    if(method!=='GET') headers['X-CSRF-TOKEN']=(await (await raw('/api/auth/csrf')).json()).token;
    if(body!==undefined) headers['Content-Type']='application/json';
    const response=await raw(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
    return response.status===204?null:response.json();
  };
  return {raw,api};
}
const owner=client(), customer=client(), other=client();
const password='Benchmark-'+randomUUID();
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const reportPath=join(root,'report.json');
const report={binary:{path:dll,sha256:digest(dll)},harnessSha256:digest(new URL(import.meta.url)),
  dotnetRuntimes:execFileSync('dotnet',['--list-runtimes'],{encoding:'utf8',windowsHide:true}).trim(),
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8',windowsHide:true}).trim(),
  workingTreeDirty:execFileSync('git',['status','--porcelain'],{cwd:workspace,encoding:'utf8',windowsHide:true}).trim().length>0,
  createdAt:new Date().toISOString(), environment:{node:process.version,os:platform()+' '+release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length},
  scope:'Warm loopback HTTP reads with synthetic JSON records; no browser rendering, upload traffic, cold cache or production capacity claim.',
  samplesPerScenario:60,warmups:5,stages:[]};
let template, customerId, otherId;
function seed(count) {
  assert(!child, 'Stop the benchmark process before seeding');
  const database=new DatabaseSync(join(root,'data/platform.db'));
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
    if(!template) {assert.equal(database.prepare('SELECT COUNT(*) AS n FROM projects').get().n,2);template=database.prepare('SELECT * FROM projects WHERE owner_id=?').get(customerId);}
    database.exec('BEGIN IMMEDIATE');
    database.exec('DELETE FROM projects');
    const columns=Object.keys(template);
    const insert=database.prepare(`INSERT INTO projects (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
    for(let i=0;i<count;i++) {
      const row={...template};
      row.id='b'+String(i).padStart(31,'0');row.owner_id=i%10===0?otherId:customerId;
      row.status=i<20?'draft':'submitted';row.workflow_status=i<20?'new':['new','in_production','completed'][i%3];
      row.task_number=i<20?null:'BENCH-'+i;row.first_submitted_at=i<20?null:'2026-01-01T00:00:00.0000000+00:00';
      row.created_at=new Date(Date.UTC(2026,0,1)+i*60000).toISOString();row.updated_at=row.created_at;
      const project=JSON.parse(row.project_json);project.projectName='基线项目 / Benchmark '+i;row.project_json=JSON.stringify(project);
      const book=JSON.parse(row.book_json);book.title=(i%100===1?'needle ':'')+'合成书籍 / Synthetic book '+i;book.authorName='Author '+i%100;book.synopsis='Synthetic synopsis. '.repeat(100);row.book_json=JSON.stringify(book);
      const creative=JSON.parse(row.creative_json);
      creative.characters=Array.from({length:16},(_,c)=>({id:'character-'+c,roleTypeId:null,name:'角色 / Character '+c,storyRole:'Supporting',personality:'Curious. '.repeat(30),appearance:'Traveling. '.repeat(30),referenceImageUrls:[],referenceImages:[]}));
      row.creative_json=JSON.stringify(creative);
      insert.run(...columns.map(key=>row[key]));
    }
    database.exec('COMMIT');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return statSync(join(root,'data/platform.db')).size;
  } finally {database.close();}
}
const round=n=>Math.round(n*100)/100;
async function measure(client, scenario, concurrency) {
  for(let i=0;i<report.warmups;i++) scenario.check(await client.api(scenario.path));
  const durations=[], statuses={}, errors=[];let index=0, bytes=0, completed=0, transportErrors=0;
  const started=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(index++<report.samplesPerScenario) {
      const start=performance.now();
      let received=false, elapsed;
      try {
        const response=await client.raw(scenario.path);const body=await response.text();
        elapsed=performance.now()-start;received=true;completed++;bytes+=Buffer.byteLength(body);
        statuses[response.status]=(statuses[response.status]??0)+1;
        assert(response.ok,'HTTP '+response.status);scenario.check(JSON.parse(body));
      } catch(error) {errors.push(error.message);if(!received)transportErrors++;}
      finally {durations.push(elapsed??performance.now()-start);}
    }
  }));
  const seconds=(performance.now()-started)/1000;
  durations.sort((a,b)=>a-b);
  const percentile=p=>durations.length?round(durations[Math.ceil(durations.length*p)-1]):null;
  const result={scenario:scenario.name,concurrency,requests:report.samplesPerScenario,completed,successful:report.samplesPerScenario-errors.length,transportErrors,latencySamples:durations.length,errors:errors.length,statuses,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:durations.length?round(durations.at(-1)):null,successfulRequestsPerSecond:round((report.samplesPerScenario-errors.length)/seconds),averageCompletedResponseBytes:completed?round(bytes/completed):null};
  if(errors.length) result.firstError=errors[0];
  console.log(JSON.stringify(result));return result;
}
try {
  await start();
  assert.equal((await owner.api('/api/auth/status')).requiresBootstrap,true,'Refusing an initialized service');
  await owner.api('/api/auth/bootstrap','POST',{displayName:'Benchmark owner',email:'owner@benchmark.test',password,organizationName:'Benchmark'});
  const org=(await owner.api('/api/me')).organization.id;
  for(const [client,email] of [[customer,'customer@benchmark.test'],[other,'other@benchmark.test']]) {
    await owner.api('/api/admin/users','POST',{displayName:email,email,password,role:'customer',organizationId:org});
    await client.api('/api/auth/login','POST',{email,password,rememberMe:false});
    await client.api('/api/projects','POST',{});
  }
  customerId=(await customer.api('/api/me')).id;otherId=(await other.api('/api/me')).id;
  if(mixed) {
    await stop(); const databaseBytes=seed(10000); await start();
    report.mixedHarnessSha256=digest(new URL('./benchmark-mixed.mjs',import.meta.url));
    const {runMixed}=await import('./benchmark-mixed.mjs');
    await runMixed({owner,customer,other,root,report,reportPath,databaseBytes,start,stop,serverPid:child.pid,sustainedSeconds:sustained?sustainedSeconds:0});
  } else for(const count of [1000,10000]) {
    await stop();const databaseBytes=seed(count);await start();
    const total=count*9/10, detailId='b'+String(21).padStart(31,'0');
    const listCheck=data=>{assert.equal(data.total,total);assert.equal(data.items.length,20);assert(data.items.every(item=>Number(item.id.slice(1))%10!==0),'Owner isolation failed');};
    const scenarios=[
      {name:'customer-list',path:'/api/projects?pageSize=20',check:listCheck,client:customer},
      {name:'customer-list-max-page',path:'/api/projects?pageSize=100',check:data=>{assert.equal(data.total,total);assert.equal(data.items.length,100);},client:customer},
      {name:'customer-search',path:'/api/projects?pageSize=20&search=needle',check:data=>{assert.equal(data.total,count/100);assert.equal(data.items.length,Math.min(20,count/100));},client:customer},
      {name:'customer-stats',path:'/api/projects/stats',check:data=>assert.equal(data.total,total),client:customer},
      {name:'customer-detail',path:'/api/projects/'+detailId,check:data=>assert.equal(data.id,detailId),client:customer},
      {name:'admin-search',path:'/api/admin/projects?pageSize=20&search=needle',check:data=>{assert.equal(data.total,count/100-1);assert.equal(data.items.length,Math.min(20,count/100-1));},client:owner},
      {name:'admin-list',path:'/api/admin/projects?pageSize=20',check:data=>{assert.equal(data.total,count-20);assert.equal(data.items.length,20);},client:owner},
    ];
    const stage={projects:count,customerProjects:total,databaseBytes,results:[]};report.stages.push(stage);
    for(const scenario of scenarios) for(const concurrency of [1,8]) {
      stage.results.push(await measure(scenario.client,scenario,concurrency));
      writeFileSync(reportPath,JSON.stringify(report,null,2));
    }
    writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));
  }
  assert(mixed ? report.mixed.passed : report.stages.every(stage=>stage.results.every(result=>result.errors===0)),'Benchmark requests failed; inspect report');
  console.log('Benchmark complete / 基线完成: '+join(root,'report.json'));
} catch(error) {report.failure=error.message;writeFileSync(reportPath,JSON.stringify(report,null,2));throw error;}
finally {await stop();}
