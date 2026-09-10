import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const scratch=path.join(root,'artifacts','runtime-listeners',randomUUID());
await mkdir(scratch,{recursive:true});
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const ports=[];while(ports.length<4){const port=await freePort();if(!ports.includes(port))ports.push(port);}
const [apiPort,customerPort,adminPort,nextCustomerPort]=ports;
const url=port=>`http://127.0.0.1:${port}`;
const listener=port=>({scheme:'http',listenAddress:'127.0.0.1',port,shared:false});
const settings={...listener(apiPort),customer:listener(customerPort),admin:listener(adminPort)};
const data=path.join(scratch,'data'),web=path.join(scratch,'web'),state=path.join(scratch,'state');
await mkdir(data,{recursive:true});
for(const name of ['customer','admin']){await mkdir(path.join(web,name),{recursive:true});await writeFile(path.join(web,name,'index.html'),`<html><body>${name}-listener</body></html>`);}
await mkdir(path.join(web,'customer','character-presets'),{recursive:true});
await writeFile(path.join(web,'customer','character-presets','test.svg'),'<svg xmlns="http://www.w3.org/2000/svg"></svg>');
await writeFile(path.join(data,'runtime-settings.json'),JSON.stringify(settings));
const exe=path.join(root,'services/platform-api/bin/Release/net10.0/Lifewood.BookPortal.Server.exe');
const run=(command,args,env={})=>new Promise((resolve,reject)=>{
 const process=spawn(command,args,{cwd:root,windowsHide:true,env:{...globalThis.process.env,...env}});let output='';process.stdout.on('data',x=>output+=x);process.stderr.on('data',x=>output+=x);process.on('error',reject);process.on('exit',code=>code===0?resolve(output):reject(new Error(output)));
});
const wait=async(port)=>{for(let i=0;i<100;i++){try{const response=await fetch(url(port)+'/api/health');if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`Listener ${port} did not start`);};
let server;
const stopServer=async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}server=undefined;};
const launcherArgs=['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/start-local.ps1','-Configuration','Release','-StateDirectory',state];
const env={Lifewood__DataDirectory:data,Lifewood__CoordinationDirectory:path.join(scratch,'coordination')};
try {
 server=spawn(exe,[`--urls=${url(apiPort)}`,`--Lifewood:DataDirectory=${data}`,`--Lifewood:WebRoot=${web}`,`--Lifewood:CoordinationDirectory=${env.Lifewood__CoordinationDirectory}`],{cwd:path.dirname(exe),windowsHide:true,stdio:'ignore'});
 await Promise.all(ports.slice(0,3).map(wait));
 assert.match(await(await fetch(url(customerPort)+'/en-US/tasks')).text(),/customer-listener/);
 assert.match(await(await fetch(url(adminPort)+'/admin/en-US/projects')).text(),/admin-listener/);
 assert.match(await(await fetch(url(adminPort)+'/character-presets/test.svg')).text(),/^<svg/);
 assert.equal((await fetch(url(adminPort),{redirect:'manual'})).headers.get('location'),'/admin/');
 assert.equal((await fetch(url(customerPort)+'/admin/en-US/projects')).status,404);
 assert.equal((await fetch(url(customerPort)+'/api/admin/runtime-settings')).status,404);
 assert.equal((await fetch(url(apiPort)+'/admin/en-US/projects')).status,404);
 assert.equal((await fetch(url(apiPort)+'/api/portals/admin?locale=en-US',{redirect:'manual'})).headers.get('location'),url(adminPort)+'/admin/en-US/projects');
 await stopServer();
 console.log('Published listeners and page routing passed.');
 await run('powershell', [...launcherArgs,'-SkipBuild'],env);
 for(const port of ports.slice(0,3))await wait(port);
 assert.match(await(await fetch(url(customerPort))).text(),/@vite\/client/);
 assert.match(await(await fetch(url(adminPort))).text(),/@vite\/client/);
 const before=JSON.parse((await readFile(path.join(state,'local-services.json'),'utf8')).replace(/^\uFEFF/,'')).processes.map(x=>x.id);
 const idle=await run('powershell',[...launcherArgs,'-SkipBuild'],env);assert.match(idle,/already running/);
 await writeFile(path.join(data,'runtime-settings.json'),JSON.stringify({...settings,customer:listener(nextCustomerPort)}));
 await run('powershell',[...launcherArgs,'-SkipBuild'],env);
 await wait(nextCustomerPort);
 const after=JSON.parse((await readFile(path.join(state,'local-services.json'),'utf8')).replace(/^\uFEFF/,'')).processes.map(x=>x.id);assert.notDeepEqual(after,before);
 assert.equal((await fetch(url(adminPort)+'/api/portals/customer?locale=en-US',{redirect:'manual'})).headers.get('location'),url(nextCustomerPort)+'/en-US/tasks');
 assert.equal((await fetch(url(nextCustomerPort)+'/api/portals/admin?locale=en-US',{redirect:'manual'})).headers.get('location'),url(adminPort)+'/en-US/projects');
 const old=await fetch(url(customerPort)).catch(()=>null);assert.equal(old,null);
 console.log('Local launcher, saved port changes, API proxies and portal links passed.');
 await writeFile(path.join(scratch,'result.json'),JSON.stringify({passed:true,ports},null,2));
 console.log(scratch);
} finally {await stopServer();await run('powershell',[...launcherArgs,'-Stop'],env).catch(error=>console.error(error.message));}
