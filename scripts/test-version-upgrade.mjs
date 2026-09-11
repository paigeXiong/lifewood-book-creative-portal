// Portable-process upgrade drill. Uses only a unique workspace fixture, never live data.
import {spawn} from 'node:child_process';
import {resolve,join,dirname,sep} from 'node:path';
import {mkdirSync,openSync,closeSync,cpSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const workspace=resolve(import.meta.dirname,'..');
assert(process.argv[2]&&process.argv[3],'Pass the previous and current server executables');
const oldExe=resolve(process.argv[2]),newExe=resolve(process.argv[3]);assert(existsSync(oldExe)&&existsSync(newExe));
const root=join(workspace,'artifacts','version-upgrade',randomUUID()),data=join(root,'data'),web=join(root,'web');
assert(root.startsWith(join(workspace,'artifacts','version-upgrade')+sep));mkdirSync(root,{recursive:true});
cpSync(join(workspace,'apps/task-entry-web/dist'),join(web,'customer'),{recursive:true});cpSync(join(workspace,'apps/admin-web/dist'),join(web,'admin'),{recursive:true});
const base='http://127.0.0.1:5099',password='Upgrade-'+randomUUID(),ownerEmail='owner@upgrade.test',customerEmail='customer@upgrade.test';
const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,browser;
function client(){const cookies=new Map();const raw=async(path,options={})=>{const headers=new Headers(options.headers);headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+path,{...options,headers,signal:AbortSignal.timeout(15000)});for(const item of r.headers.getSetCookie()){const pair=item.split(';',1)[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;};
 const api=async(path,method='GET',body)=>{const headers={};if(method!=='GET')headers['X-CSRF-TOKEN']=(await(await raw('/api/auth/csrf')).json()).token;if(body!==undefined&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}const r=await raw(path,{method,headers,body});assert(r.ok,path+' returned '+r.status+' '+(r.ok?'':await r.text()));return r.status===204?null:r.json();};
 return {raw,api,login:email=>api('/api/auth/login','POST',{email,password,rememberMe:false})};}
const owner=client(),customer=client();
function start(exe,label,broken=false){const fd=openSync(join(root,label+'.log'),'a');child=spawn(exe,['--urls',base,'--Lifewood:DataDirectory='+data,'--Lifewood:BackupDirectory='+join(root,'backups'),'--Lifewood:CoordinationDirectory='+join(root,'coordination'),'--Lifewood:LocalProcessRecord='+join(root,'process.json'),'--Lifewood:LocalLaunchId=upgrade-fixture','--Lifewood:RequireWebAssets=true','--Lifewood:WebRoot='+(broken?join(root,'missing-web'):web),'--Lifewood:CustomerUrl='+base,'--Lifewood:AdminUrl='+base+'/admin'],{cwd:dirname(exe),env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'},windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);return child;}
async function ready(){for(let i=0;i<240;i++){assert(child.exitCode===null,'Server exited: inspect '+root);try{if((await fetch(base+'/api/health')).ok)return;}catch{}await delay(250);}throw new Error('Startup timeout');}
async function waitExit(process,exit,timeout=15000){let timer;try{return await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>{if(process.exitCode===null)process.kill();reject(new Error('Process exit timeout'));},timeout);})]);}finally{clearTimeout(timer);}}
async function stop(){const target=child;if(!target||target.exitCode!==null)return;const stopped=once(target,'exit');try{await owner.login(ownerEmail);await owner.api('/api/admin/runtime-actions/shutdown','POST',{});}catch{target.kill();}await waitExit(target,stopped);if(child===target)child=undefined;}
let project,asset;const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9uoAAAAASUVORK5CYII=','base64');const hash=b=>createHash('sha256').update(b).digest('hex');
async function verify(){await owner.login(ownerEmail);await customer.login(customerEmail);const me=await customer.api('/api/me');assert.equal(me.displayName,'Upgrade customer');assert.equal(me.organization.name,'Upgrade organization');const saved=await customer.api('/api/projects/'+project.id);assert.equal(saved.book.title,'升级保留 / Upgrade fixture');assert.equal(saved.project.projectName,'升级保留 / Upgrade fixture');assert.equal(saved.version,project.version);assert.equal(hash(Buffer.from(await(await customer.raw(asset.url)).arrayBuffer())),hash(png));assert.equal((await owner.api('/api/admin/notifications/rules')).retentionDays,233);assert.equal((await customer.api('/api/notifications/preferences')).toast,false);}
try{
 try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});throw new Error('Fixture port is occupied');}catch(e){if(e.message==='Fixture port is occupied')throw e;}
 start(oldExe,'previous');await ready();await owner.api('/api/auth/bootstrap','POST',{displayName:'Upgrade owner',email:ownerEmail,password,organizationName:'Owner organization'});
 const org=await owner.api('/api/admin/organizations','POST',{name:'Upgrade organization'});await owner.api('/api/admin/users','POST',{displayName:'Upgrade customer',email:customerEmail,password,role:'customer',organizationId:org.id});await customer.login(customerEmail);
 project=await customer.api('/api/projects','POST',{});project=await customer.api('/api/projects/'+project.id+'/draft','PUT',{version:project.version,project:{...project.project,projectName:'升级保留 / Upgrade fixture'},book:{...project.book,title:'升级保留 / Upgrade fixture'}});
 const upload=new FormData();upload.set('version',String(project.version));upload.set('categoryId','book-cover');upload.set('file',new Blob([png],{type:'image/png'}),'cover.png');const uploaded=await customer.api('/api/projects/'+project.id+'/files?categoryId=book-cover','POST',upload);project=uploaded.draft;asset=uploaded.asset;
 await owner.api('/api/admin/notifications/retention','PUT',{days:233});await customer.api('/api/notifications/preferences','PUT',{toast:false,sound:false,quietStart:null,quietEnd:null,timeZone:'UTC',mutedKinds:[]});await verify();await stop();cpSync(data,join(root,'pre-upgrade-copy'),{recursive:true});
 start(newExe,'upgraded');await ready();await verify();await stop();
 const broken=start(newExe,'failed-startup',true);const [code]=await waitExit(broken,once(broken,'exit'));assert.notEqual(code,0);
 start(oldExe,'previous-fallback');await ready();await verify();await stop();
 start(newExe,'production-ui');await ready();browser=await chromium.launch({headless:true});const context=await browser.newContext();let token=(await(await context.request.get(base+'/api/auth/csrf')).json()).token;assert((await context.request.post(base+'/api/auth/login',{headers:{'X-CSRF-TOKEN':token},data:{email:ownerEmail,password,rememberMe:false}})).ok());
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function browserLogin(email){const token=(await(await context.request.get(base+'/api/auth/csrf')).json()).token;assert((await context.request.post(base+'/api/auth/login',{headers:{'X-CSRF-TOKEN':token},data:{email,password,rememberMe:false}})).ok());}
 for(const locale of ['zh-CN','en-US']){
  await browserLogin(customerEmail);await page.goto(base+'/'+locale+'/tasks');await page.getByText('升级保留 / Upgrade fixture',{exact:true}).first().waitFor();
  await page.goto(base+'/'+locale+'/tasks/'+project.id+'/edit/project');await expect(page.locator('#title')).toHaveValue('升级保留 / Upgrade fixture');assert.equal(new URL(page.url()).pathname,'/'+locale+'/tasks/'+project.id+'/edit/project');
  await browserLogin(ownerEmail);
  for(const route of ['projects','users','settings/notifications']){
   const path='/admin/'+locale+'/'+route;const response=route==='projects'?page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/projects'):null;await page.goto(base+path);if(response)assert((await response).ok());
   await page.locator(route==='projects'?'.projects-content .project-pane > .empty':route==='users'?'.users-content tbody tr':'.notification-rule-list article').first().waitFor();
   if(route==='users')await page.getByText('Upgrade customer',{exact:true}).waitFor();
   if(route==='settings/notifications')await page.getByText(locale==='zh-CN'?'自动备份失败':'Automatic backup failed',{exact:true}).first().waitFor();
   assert.equal(new URL(page.url()).pathname,path);assert.equal(await page.locator('[role="alert"], .message.error').count(),0);
  }
  await page.screenshot({path:join(root,'production-'+locale+'.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);await browser.close();browser=null;await stop();
 const result={passed:true,previous:oldExe,current:newExe,checks:['previous version creates real accounts, organization, project and PNG upload','upgrade preserves passwords, organization, project version and attachment hash','notification settings and preferences retained','invalid web package refuses startup','previous executable can reopen data after failed startup','production chunks and both locales render without page errors'],root};writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();if(child?.exitCode===null && child.signalCode===null){const target=child,stopped=once(target,'exit');target.kill();await waitExit(target,stopped);}}
