// Opt-in diagnostics: only disposable Playwright data and the test-owned Chromium context.
import { expect, test, type Page, type CDPSession } from "@playwright/test";
import type { FinalDelivery } from "@lifewood/domain";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { gotoInAccountLocale } from "./auth-request";

const normal={offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1};
const slow={offline:false,latency:120,downloadThroughput:512_000,uploadThroughput:256_000};
async function sha(path:string){const h=createHash("sha256");for await(const b of createReadStream(path))h.update(b);return h.digest("hex");}
async function headers(page:Page){return {"X-CSRF-TOKEN":(await(await page.request.get("/api/auth/csrf")).json()).token};}
async function movie(path:string,size:number){
 const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const box=(name:string,...parts:Buffer[])=>{const data=Buffer.concat(parts);return Buffer.concat([u32(data.length+8),Buffer.from(name),data]);};
 const ftyp=box("ftyp",Buffer.from("isom"),u32(0),Buffer.from("isom"));
 const table=box("stbl",box("stsd",u32(0),u32(1),box("avc1")),box("stsz",u32(0),u32(1),u32(1)));
 const moov=box("moov",box("trak",box("mdia",box("hdlr",Buffer.alloc(8),Buffer.from("vide")),box("minf",table))));
 const file=await open(path,"w");try{await file.truncate(size);await file.write(ftyp,0,ftyp.length,0);const mdat=Buffer.concat([u32(size-ftyp.length-moov.length),Buffer.from("mdat")]);await file.write(mdat,0,8,ftyp.length);await file.write(moov,0,moov.length,size-moov.length);}finally{await file.close();}
}

export async function stressTransfers(page:Page,admin:Page,projectId:string){
 test.setTimeout(test.info().timeout+360_000);
 const root=resolve("artifacts/transfer-stress",projectId);await mkdir(root,{recursive:true});
 const report:Record<string,unknown>={startedAt:new Date().toISOString(),browser:page.context().browser()?.version(),fileBytes:500_000_000,network:slow,checks:[]};
 const checks=report.checks as unknown[];
 let responseBytes=0,requestBytes=0,faultResponseCount=0;
 const faultServer=createServer((req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","http://127.0.0.1:5193");res.setHeader("Access-Control-Allow-Credentials","true");
  if(req.method==="OPTIONS"){res.setHeader("Access-Control-Allow-Headers",req.headers["access-control-request-headers"]??"*");res.setHeader("Access-Control-Allow-Methods","GET,POST");res.end();return;}
  if(req.method==="POST"){let received=0;requestBytes=0;req.on("data",chunk=>{received+=chunk.length;requestBytes=received;if(received>=131072)req.socket.destroy();});return;}
  let sent=0;responseBytes=0;faultResponseCount++;
  res.writeHead(200,{"Content-Type":"video/mp4","Content-Length":"500000000"});
  const timer=setInterval(()=>{if(sent>=262144){clearInterval(timer);res.destroy();return;}res.write(Buffer.alloc(65536));sent+=65536;responseBytes=sent;},30);
  res.on("close",()=>clearInterval(timer));
 });
 let cleanupClient:CDPSession|undefined,previous:FinalDelivery|undefined,original:Buffer|undefined;
 let largeId:string|undefined,revoked=false;
 try{
 // This outer workflow exercises the compatibility download; memory uses a separate browser.
 await page.addInitScript(()=>{Object.defineProperty(window,"showSaveFilePicker",{value:undefined,configurable:true});});
 await page.evaluate(()=>{Object.defineProperty(window,"showSaveFilePicker",{value:undefined,configurable:true});});
 await new Promise<void>((resolve,reject)=>{faultServer.once("error",reject);faultServer.listen(0,"127.0.0.1",resolve);});
 const address=faultServer.address();if(!address||typeof address==="string")throw new Error("Missing fault listener");
 const faultUrl=`http://127.0.0.1:${address.port}/interrupted`;

 await page.unrouteAll({behavior:"wait"});
 const client=cleanupClient=await page.context().newCDPSession(page);await client.send("Network.enable");
 previous=(await(await admin.request.get(`/api/admin/projects/${projectId}/deliveries`)).json()).find((d:FinalDelivery)=>!d.revokedAt);
 if(!previous)throw new Error("Missing original delivery fixture");
 expect(previous.sizeBytes).toBeLessThan(1_000_000);
 original=await(await admin.request.get(`/api/admin/projects/${projectId}/deliveries/${previous.id}/file`)).body();
  expect((await admin.request.delete(`/api/admin/projects/${projectId}/deliveries/${previous.id}`,{headers:await headers(admin)})).ok()).toBeTruthy();revoked=true;
  await admin.reload();
  const video=resolve(root,"boundary-500mb.mp4");await movie(video,500_000_000);const hash=await sha(video);report.sha256=hash;
  await admin.locator('[data-project-action="delivery"] button').click();const dialog=admin.getByRole("dialog");
  await dialog.locator('input[name="file"]').setInputFiles(video);
  const started=Date.now();const published=admin.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname===`/api/admin/projects/${projectId}/deliveries`,{timeout:120_000});
  await dialog.locator("button.primary").click();const uploaded=await published;expect(uploaded.ok(),await uploaded.text()).toBeTruthy();const delivery=await uploaded.json();largeId=delivery.id;
  expect(delivery.sizeBytes).toBe(500_000_000);await expect(dialog).not.toBeVisible({timeout:120_000});
  checks.push({case:"500 MB browser upload",milliseconds:Date.now()-started});
  const filePath=`/api/projects/${projectId}/deliveries/${largeId}/file`;
  if(process.env.LW_TRANSFER_MEMORY==="1"){
   const {diagnoseTransferMemory}=await import("./transfer-memory");
   await diagnoseTransferMemory(page,projectId,filePath,root,hash,faultUrl,()=>({count:faultResponseCount,bytes:responseBytes}));
  }
  for(const locale of ["zh-CN","en-US"]){
   await gotoInAccountLocale(page,`http://127.0.0.1:5193/${locale}/tasks/${projectId}`);
   const section=page.locator(".customer-delivery");const row=section.locator("li").filter({hasText:"boundary-500mb.mp4"});await expect(row).toBeVisible();
   const button=row.getByRole("button");
   let requestId="",responseSeen=false;
   const cancelled=new Set<string>();
   const failed=(e:{requestId:string;canceled?:boolean})=>{if(e.canceled)cancelled.add(e.requestId);};
   const response=(e:{requestId:string;response:{url:string}})=>{if(new URL(e.response.url).pathname===filePath)responseSeen=true;};
   const request=(e:{requestId:string;request:{url:string}})=>{if(new URL(e.request.url).pathname===filePath)requestId=e.requestId;};
   client.on("Network.requestWillBeSent",request);client.on("Network.loadingFailed",failed);client.on("Network.responseReceived",response);
   try{
    await client.send("Network.emulateNetworkConditions",slow);
    const downloads:unknown[]=[];const observe=(d:unknown)=>downloads.push(d);page.on("download",observe);
    await button.click();await expect.poll(()=>responseSeen,{timeout:15000}).toBe(true);
    const cancelledId=requestId;
    await section.getByRole("button",{name:locale==="zh-CN"?"取消":"Cancel",exact:true}).click();await expect(button).toBeEnabled();
    await expect.poll(()=>cancelled.has(cancelledId)).toBe(true);
    await client.send("Network.emulateNetworkConditions",normal);expect(downloads).toHaveLength(0);page.off("download",observe);
    checks.push({case:"cancel in-flight download after headers",locale,networkCancelled:true});
    responseBytes=0;
    await page.route(`**${filePath}`,route=>route.continue({url:faultUrl}));
    await button.click();await expect(section.getByRole("alert")).toBeVisible({timeout:15000});
    expect(responseBytes).toBeGreaterThanOrEqual(131072);
    await page.screenshot({path:resolve(root,`download-disconnected-${locale}.png`)});
    await page.unroute(`**${filePath}`);
    // A polling failure can replace the file list with its own retry action.
    if(!await button.isVisible())await section.getByRole("button",{name:locale==="zh-CN"?"重试":"Retry",exact:true}).click();
    await expect(button).toBeEnabled({timeout:15000});
    const complete=page.waitForEvent("download",{timeout:120_000});const start=Date.now();await button.click();const download=await complete;
    const saved=(await download.path())!;expect((await stat(saved)).size).toBe(500_000_000);expect(await sha(saved)).toBe(hash);
    checks.push({case:"connection-drop recovery and complete download",locale,bytesBeforeDisconnect:responseBytes,downloadedBytes:500_000_000,sha256:hash,milliseconds:Date.now()-start});
   }finally{report.downloadDiagnostics={requestId,responseSeen};client.off("Network.requestWillBeSent",request);client.off("Network.loadingFailed",failed);client.off("Network.responseReceived",response);await client.send("Network.emulateNetworkConditions",normal);}
  }
  // Customer source upload: cancel partial transfer, interrupt retry, then replay the same selected file.
  for(const locale of ["zh-CN","en-US"]){
   const options=await(await page.request.get(`/api/form-options?locale=${locale}`)).json();
   const category=options.sourceCategories.find((c:{accept:string[];maxBytes:number})=>c.accept.includes("application/pdf")&&c.maxBytes>=8_000_000);expect(category).toBeTruthy();
   const created=await page.request.post("/api/projects",{headers:await headers(page),data:{}});expect(created.ok()).toBeTruthy();const draft=await created.json();
   const pdf=resolve(root,`source-${locale}.pdf`);const file=await open(pdf,"w");await file.truncate(8_000_000);await file.write(Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"));await file.close();
   await gotoInAccountLocale(page,`http://127.0.0.1:5193/${locale}/tasks/${draft.id}/edit/project`);
   let uploadId="";const cancelledUploads=new Set<string>();
   const uploadRequest=(event:{requestId:string;request:{url:string;method:string}})=>{if(event.request.method==="POST"&&new URL(event.request.url).pathname===`/api/projects/${draft.id}/files`)uploadId=event.requestId;};
   const uploadFailed=(event:{requestId:string;canceled?:boolean})=>{if(event.canceled)cancelledUploads.add(event.requestId);};
   client.on("Network.requestWillBeSent",uploadRequest);client.on("Network.loadingFailed",uploadFailed);
   try{
   await client.send("Network.emulateNetworkConditions",slow);
   await page.locator(`#source-upload-${category.id}`).setInputFiles(pdf);
   const transfer=page.locator(".file-transfers li").filter({hasText:`source-${locale}.pdf`});
   await expect.poll(async()=>Number(await transfer.locator("progress").getAttribute("value")),{timeout:15000}).toBeGreaterThan(0);
   expect(Number(await transfer.locator("progress").getAttribute("value"))).toBeLessThan(100);
   await transfer.getByRole("button").click();await expect(transfer.locator("progress")).toHaveCount(0);
   await expect.poll(()=>uploadId!==""&&cancelledUploads.has(uploadId)).toBe(true);
   checks.push({case:"cancel partial source upload",locale,networkCancelled:true});
   await client.send("Network.emulateNetworkConditions",normal);
   requestBytes=0;const uploadRoute=`**/api/projects/${draft.id}/files?*`;
   await page.route(uploadRoute,route=>route.continue({url:faultUrl}));
   await transfer.getByRole("button",{name:new RegExp(locale==="zh-CN"?"重试上传":"Retry upload")}).click();
   await expect(transfer.getByRole("alert")).toBeVisible({timeout:15000});expect(requestBytes).toBeGreaterThanOrEqual(131072);
   await page.screenshot({path:resolve(root,`upload-disconnected-${locale}.png`)});
   await page.unroute(uploadRoute);
   await transfer.getByRole("button",{name:new RegExp(locale==="zh-CN"?"重试上传":"Retry upload")}).click();
   await expect(transfer).toHaveCount(0,{timeout:45000});
   const latest=await(await page.request.get(`/api/projects/${draft.id}`)).json();
   const assets=latest.book.sourceAssets.filter((a:{fileName:string})=>a.fileName===`source-${locale}.pdf`);expect(assets).toHaveLength(1);
   const response=await page.request.get(assets[0].url);expect(response.ok()).toBeTruthy();const content=await response.body();expect(content.length).toBe(8_000_000);expect(createHash("sha256").update(content).digest("hex")).toBe(await sha(pdf));
   checks.push({case:"connection-drop source retry creates exactly one identical asset",locale,bytesBeforeDisconnect:requestBytes,fileBytes:content.length,sha256:await sha(pdf)});
   }finally{client.off("Network.requestWillBeSent",uploadRequest);client.off("Network.loadingFailed",uploadFailed);await client.send("Network.emulateNetworkConditions",normal);}
  }
  report.checksPassed=true;
 }catch(error){report.error=String(error);throw error;}
 finally{
  const cleanupErrors:string[]=[];
  faultServer.closeAllConnections();if(faultServer.listening)await new Promise<void>(resolve=>faultServer.close(()=>resolve()));
  if(cleanupClient)for(const cleanup of [()=>cleanupClient!.send("Network.emulateNetworkConditions",normal),()=>cleanupClient!.detach()])try{await cleanup();}catch(error){cleanupErrors.push(String(error));}
  try{
   if(largeId){const removed=await admin.request.delete(`/api/admin/projects/${projectId}/deliveries/${largeId}`,{headers:await headers(admin)});expect(removed.ok()).toBeTruthy();}
   if(revoked&&previous&&original){const restored=await admin.request.post(`/api/admin/projects/${projectId}/deliveries`,{headers:await headers(admin),multipart:{file:{name:previous.fileName,mimeType:previous.contentType,buffer:original},note:previous.note??""}});expect(restored.ok(),await restored.text()).toBeTruthy();}
   await gotoInAccountLocale(page,`http://127.0.0.1:5193/zh-CN/tasks/${projectId}`);await admin.reload();
  }catch(error){cleanupErrors.push(String(error));}
  report.cleanupErrors=cleanupErrors;report.passed=report.checksPassed===true&&!cleanupErrors.length;
  report.finishedAt=new Date().toISOString();await writeFile(resolve(root,"report.json"),JSON.stringify(report,null,2));
  expect(cleanupErrors).toEqual([]);
 }
}
