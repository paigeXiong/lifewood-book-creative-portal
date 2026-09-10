// Windows-only, isolated data. Retains its artifacts for inspection; never uses the installed data directory.
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {resolve,join,dirname,sep} from "node:path";
import {mkdirSync,existsSync,openSync,closeSync,readdirSync,writeFileSync,readFileSync} from "node:fs";
import {randomUUID,createHash} from "node:crypto";
import assert from "node:assert/strict";
const [previous,current]=process.argv.slice(2);
assert(process.platform==="win32" && previous && current,"Pass previous and current server directories on Windows.");
const workspace=resolve(import.meta.dirname,".."),baseRoot=join(workspace,"artifacts","upgrade-recovery"),run=join(baseRoot,randomUUID()),data=join(run,"data");
assert(resolve(data).startsWith(resolve(baseRoot)+sep));mkdirSync(run,{recursive:true});
const binaries=[previous,current].map(directory=>join(resolve(directory),"Lifewood.BookPortal.Server.exe"));binaries.forEach(path=>assert(existsSync(path),"Missing server executable"));
const base="http://127.0.0.1:5097",password="Upgrade-test-"+randomUUID(),email="upgrade@example.test";
let processHandle;const cookies=new Map();
function command(exe,args){return execFileSync(exe,args,{cwd:workspace,windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
async function start(binary,label){
 const fd=openSync(join(run,label+".log"),"a");
 processHandle=spawn(binary,["--urls",base],{cwd:dirname(binary),windowsHide:true,stdio:["ignore",fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:"Development",Lifewood__DataDirectory:data,Lifewood__CoordinationDirectory:join(run,"coordination"),Lifewood__RequireWebAssets:"false"}});closeSync(fd);
 for(let n=0;n<100;n++){if(processHandle.exitCode!==null)throw new Error("Server exited; inspect "+label+".log");try{if((await fetch(base+"/api/health")).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw new Error("Server startup timed out");
}
async function stop(){if(processHandle&&processHandle.exitCode===null){const ended=once(processHandle,"exit");processHandle.kill();await ended;}processHandle=undefined;}
async function raw(path,options={}){const headers=new Headers(options.headers);headers.set("Cookie",[...cookies].map(([k,v])=>k+"="+v).join("; "));const response=await fetch(base+path,{...options,headers});for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(";",1)[0],cut=pair.indexOf("=");cookies.set(pair.slice(0,cut),pair.slice(cut+1));}assert(response.ok,path+" returned "+response.status+": "+(response.ok?"":await response.text()));return response;}
async function api(path,method="GET",body){const headers={};if(method!=="GET")headers["X-CSRF-TOKEN"]=(await(await raw("/api/auth/csrf")).json()).token;if(body && !(body instanceof FormData)){headers["Content-Type"]="application/json";body=JSON.stringify(body);}const response=await raw(path,{method,headers,body});return response.status===204?null:response.json();}
async function login(){cookies.clear();await api("/api/auth/login","POST",{email,password,rememberMe:false});}
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
let project,owner,file,deliveryId,expectedFile,expectedDelivery;
async function validate(){await login();assert.equal((await api("/api/me")).id,owner.id);assert.equal((await api("/api/projects/"+project.id)).id,project.id);assert.equal(hash(Buffer.from(await(await raw(`/api/projects/${project.id}/files/${file.id}`)).arrayBuffer())),expectedFile);assert.equal(hash(Buffer.from(await(await raw(`/api/projects/${project.id}/deliveries/${deliveryId}/file`)).arrayBuffer())),expectedDelivery);}
try{
 try {await fetch(base+"/api/health");throw new Error("Test port 5097 is already in use");} catch(error){if(error.message.includes("already in use"))throw error;}
 await start(binaries[0],"previous");
 await api("/api/auth/bootstrap","POST",{displayName:"Upgrade fixture",email,password,organizationName:"Upgrade fixture organization"});owner=await api("/api/me");project=await api("/api/projects","POST",{});
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");const form=new FormData();form.set("file",new Blob([png],{type:"image/png"}),"cover.png");form.set("categoryId","book-cover");form.set("version",String(project.version));file=(await api(`/api/projects/${project.id}/files?categoryId=book-cover`,"POST",form)).asset;
 expectedFile=hash(Buffer.from(await(await raw(`/api/projects/${project.id}/files/${file.id}`)).arrayBuffer()));
 await api("/api/admin/notifications/retention","PUT",{days:366});
 await stop();
 // A disposable delivery fixture avoids requiring a production media workflow.
 deliveryId=randomUUID().replaceAll("-","");const delivery=Buffer.from("isolated-upgrade-delivery-fixture");expectedDelivery=hash(delivery);mkdirSync(join(data,"deliveries",project.id),{recursive:true});writeFileSync(join(data,"deliveries",project.id,deliveryId+"_fixture.mp4"),delivery);
 command("python",["-c",`import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("INSERT INTO project_deliveries(id,project_id,uploader_user_id,file_name,content_type,size_bytes,published_at) VALUES(?,?,?,'fixture.mp4','video/mp4',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",(sys.argv[2],sys.argv[3],sys.argv[4],int(sys.argv[5]))); c.commit(); c.close()`,join(data,"platform.db"),deliveryId,project.id,owner.id,String(delivery.length)]);
 await start(binaries[0],"previous-validated");await validate();await stop();
 command("powershell",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(workspace,"scripts","backup-platform.ps1"),"-DataDirectory",data,"-Destination",join(run,"backups")]);const archive=join(run,"backups",readdirSync(join(run,"backups")).find(name=>name.endsWith(".zip")));
 await start(binaries[1],"upgraded");await validate();const history=await api("/api/admin/audit-events");assert(history.items.length>0);await api("/api/admin/notifications/retention","PUT",{days:365});const changed=await api("/api/admin/audit-events?actionId=notification.config");assert(changed.items.some(item=>item.context?.changes?.some(field=>field.field==="retentionDays")));await stop();
 await start(binaries[1],"restarted");await validate();await stop();
 writeFileSync(join(data,"deliveries",project.id,deliveryId+"_fixture.mp4"),"simulated damage");
 assert(resolve(data).startsWith(resolve(baseRoot)+sep));
 command("powershell",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(workspace,"scripts","restore-platform.ps1"),"-Archive",archive,"-DataDirectory",data,"-CoordinationDirectory",join(run,"coordination"),"-SafetyBackupDestination",join(run,"safety-backups"),"-Replace"]);
 await start(binaries[1],"restored");await validate();await stop();
 const result={passed:true,previous:resolve(previous),current:resolve(current),checks:["previous package startup","real account and project","HTTP attachment download","delivery fixture download","backup","schema upgrade","historical audit retained","new audit changes","repeat startup","restore replaced damaged file","post-restore login and file hashes"],finishedAt:new Date().toISOString()};writeFileSync(join(run,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,result:join(run,"result.json")}));
}finally{await stop();}
