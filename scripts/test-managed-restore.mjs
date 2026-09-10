// Managed restore drills use only a fresh directory under artifacts; never the live installation.
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join,dirname,sep} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync,openSync,closeSync,cpSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const workspace=resolve(import.meta.dirname,'..'),baseRoot=join(workspace,'artifacts','managed-restore'),run=join(baseRoot,randomUUID()),data=join(run,'data'),storage=data+'.backups';
assert(data.startsWith(baseRoot+sep));mkdirSync(run,{recursive:true});
const executable=resolve(process.argv[2]||join(workspace,'services/platform-api/bin/Release/net10.0/Lifewood.BookPortal.Server.exe'));
const base='http://127.0.0.1:5098',email='restore@example.test',password='Restore-test-'+randomUUID();
const args=['--urls',base,'--Lifewood:DataDirectory='+data,'--Lifewood:CoordinationDirectory='+join(run,'coordination'),'--Lifewood:RequireWebAssets=false','--Lifewood:LocalProcessRecord='+join(run,'api-process.json'),'--Lifewood:LocalLaunchId=restore-fixture'];
const env={...process.env,ASPNETCORE_ENVIRONMENT:'Development'};let processHandle;const cookies=new Map();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function start(exe,argv,label){const fd=openSync(join(run,label+'.log'),'a');const child=spawn(exe,argv,{cwd:dirname(executable),env,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);return child;}
async function health(){
 // Health responds before the restore helper commits and the child releases BackupGate.
 // Wait for an anonymous business request to reach authentication before checking saved sessions.
 for(let i=0;i<240;i++){
  try{if((await fetch(base+'/api/health')).ok && (await fetch(base+'/api/me')).status===401)return;}catch{}
  await delay(250);
 }
 throw new Error('Startup timeout: business requests did not resume');
}
async function raw(path,options={}){const headers=new Headers(options.headers);headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+path,{...options,headers});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';',1)[0],cut=pair.indexOf('=');cookies.set(pair.slice(0,cut),pair.slice(cut+1));}return r;}
async function api(path,method='GET',body){const headers={};if(method!=='GET')headers['X-CSRF-TOKEN']=(await(await raw('/api/auth/csrf')).json()).token;if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}const r=await raw(path,{method,headers,body});assert(r.ok,path+' '+r.status+' '+(r.ok?'':await r.text()));return r.status===204?null:r.json();}
async function login(){cookies.clear();await api('/api/auth/login','POST',{email,password,rememberMe:false});}
const journalPath=join(storage,'.backup-restore.json');
function journal(){return JSON.parse(readFileSync(journalPath,'utf8').replace(/^\uFEFF/,''));}
async function completed(expected){for(let i=0;i<500;i++){if(existsSync(journalPath)){const status=journal().state.status;if(['completed','failed','rolledBack','recoveryRequired'].includes(status)){assert.equal(status,expected,JSON.stringify(journal().state));return;}}await delay(250);}throw new Error('Restore timeout');}
async function shutdown(){try{await login();await api('/api/admin/runtime-actions/shutdown','POST',{});for(let i=0;i<80;i++){try{await fetch(base+'/api/health');}catch{for(let lockAttempt=0;lockAttempt<120;lockAttempt++){try{const fd=openSync(join(data,'platform.lock'),'r+');closeSync(fd);return;}catch{await delay(250);}}throw new Error('Data lock still held after shutdown');}await delay(250);}throw new Error('Shutdown timeout');}catch(error){if(processHandle?.exitCode===null)processHandle.kill();throw error;}}
try {
 try{await fetch(base+'/api/health');throw new Error('Test port is occupied');}catch(e){if(e.message==='Test port is occupied')throw e;}
 processHandle=start(executable,args,'initial');await health();
 await api('/api/auth/bootstrap','POST',{displayName:'Restore fixture',email,password,organizationName:'Restore fixture'});
 const original=await api('/api/projects','POST',{});writeFileSync(join(data,'restore-fixture.txt'),'snapshot');
 const backup=await api('/api/admin/backups','POST',{});
 for(let i=0;i<240;i++){const item=(await api('/api/admin/backups')).items.find(x=>x.id===backup.id);if(item.status==='completed')break;assert.notEqual(item.status,'failed');await delay(250);}
 const late=await api('/api/projects','POST',{});writeFileSync(join(data,'restore-fixture.txt'),'before-restore');
 await api('/api/admin/backups/policy','PUT',{enabled:false,frequency:'daily',hour:2,dayOfWeek:0,timeZoneId:'Asia/Shanghai',retainDays:30,retainCount:22});
 const preview=await api('/api/admin/backups/'+backup.id+'/preflight','POST',{});assert(preview.fileCount>0);
 const bad=await raw('/api/admin/backups/restore',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':(await(await raw('/api/auth/csrf')).json()).token},body:JSON.stringify({token:preview.token,confirmation:'wrong'})});assert.equal(bad.status,409);
 await api('/api/admin/backups/restore','POST',{token:preview.token,confirmation:'RESTORE'});await completed('completed');await health();assert.notEqual(JSON.parse(readFileSync(join(run,'api-process.json'),'utf8')).id,processHandle.pid,'Launcher receipt must follow the restored server');
 assert.equal((await raw('/api/me')).status,401,'Restored sessions must be invalid');await login();
 assert.equal((await api('/api/projects/'+original.id)).id,original.id);assert.equal((await raw('/api/projects/'+late.id)).status,404);assert.equal(readFileSync(join(data,'restore-fixture.txt'),'utf8'),'snapshot');
 const firstHistory=await api('/api/admin/backups/restore/history');assert(firstHistory.items.some(x=>x.id===journal().state.id&&x.status==='completed'&&x.actorName==='Restore fixture'));
 const backups=await api('/api/admin/backups');assert.equal(backups.schedule.policy.retainCount,22);const safety=backups.items.find(x=>x.source==='safety');assert.equal(safety.status,'completed');
 execFileSync('python',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.read('restore-fixture.txt')==b'before-restore'",join(storage,'backup-'+safety.id+'.zip')],{windowsHide:true});
 await shutdown();
 // Fault injection in isolated staging proves a failed child startup rolls back the whole data directory.
 const prior=journal(),id=randomUUID().replaceAll('-',''),stage=data+'.restore-'+id;cpSync(data,stage,{recursive:true});writeFileSync(join(stage,'platform.db'),'not a database');
 const parent=start(process.execPath,['-e','setTimeout(()=>{},2500)'],'dummy-parent');
 const failed={...prior,state:{id,backupId:backup.id,status:'restarting',updatedAt:new Date().toISOString(),safetyBackupId:safety.id},parentPid:parent.pid,executable,arguments:args,workingDirectory:dirname(executable)};writeFileSync(journalPath,JSON.stringify(failed));
 const helper=start(executable,['--apply-restore',journalPath],'rollback-helper');await completed('rolledBack');await health();await login();assert.equal(readFileSync(join(data,'restore-fixture.txt'),'utf8'),'snapshot');assert.equal((await api('/api/projects/'+original.id)).id,original.id);const history=await api('/api/admin/backups/restore/history');assert(history.items.some(x=>x.status==='completed')&&history.items.some(x=>x.status==='rolledBack'),'Restore outcomes must survive subsequent restore and rollback');await shutdown();
 const result={passed:true,checks:['preflight','explicit confirmation','safety archive preserves current files','data rollback to backup','snapshot sessions revoked','current backup policy preserved','restored startup','failed startup auto rollback'],run};writeFileSync(join(run,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {if(processHandle?.exitCode===null)processHandle.kill();}
