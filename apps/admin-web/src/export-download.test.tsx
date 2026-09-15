// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { saveExport, useExportDownload } from "./useExportDownload";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const createUrl=vi.fn(()=>"blob:export"),revokeUrl=vi.fn();
beforeEach(()=>{vi.stubGlobal("URL",class extends URL {static createObjectURL=createUrl;static revokeObjectURL=revokeUrl;});vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();createUrl.mockClear();revokeUrl.mockClear();});
async function fixture() {
 let hook!:ReturnType<typeof useExportDownload>;
 const root=createRoot(document.createElement("div"));
 function Harness({scope}:{scope:string}) {hook=useExportDownload(scope);return null;}
 const render=async(scope:string)=>{await act(async()=>root.render(<Harness scope={scope}/>));};
 await render("initial");
 return {get hook(){return hook;},render,close:async()=>{await act(async()=>root.unmount());}};
}
it("starts only one request on rapid clicks and permits explicit retry after failure",async()=>{
 let reject!:(error:unknown)=>void;
 const request=vi.fn(()=>new Promise<Blob>((_,fail)=>{reject=fail;}));const f=await fixture();
 try {
  let first!:Promise<void>;
  await act(async()=>{first=f.hook.run(request,"audit.csv");void f.hook.run(request,"audit.csv");});
  expect(request).toHaveBeenCalledOnce();expect(f.hook.pending).toBe(true);
  const error=new api.ApiError({code:"network.unavailable",messageKey:"errors.network.unavailable",retryable:true});
  await act(async()=>{reject(error);await first;});
  expect(f.hook.error).toBe(error);expect(f.hook.pending).toBe(false);expect(createUrl).not.toHaveBeenCalled();
  await act(async()=>f.hook.run(async()=>new Blob(["csv"]),"audit.csv"));
  expect(f.hook.error).toBeUndefined();expect(createUrl).toHaveBeenCalledOnce();
 } finally {await f.close();}
});
it("cancels immediately and ignores a late response without resetting a newer request",async()=>{
 let oldFinish!:(blob:Blob)=>void,newFinish!:(blob:Blob)=>void,signal!:AbortSignal;
 const f=await fixture();let old!:Promise<void>,next!:Promise<void>;
 try {
  await act(async()=>{old=f.hook.run(s=>{signal=s;return new Promise(resolve=>{oldFinish=resolve;});},"old.zip");});
  await act(async()=>f.hook.cancel());expect(signal.aborted).toBe(true);expect(f.hook.pending).toBe(false);
  await act(async()=>{next=f.hook.run(()=>new Promise(resolve=>{newFinish=resolve;}),"new.zip");});
  await act(async()=>{oldFinish(new Blob(["old"]));await old;});
  expect(f.hook.pending).toBe(true);expect(createUrl).not.toHaveBeenCalled();
  await act(async()=>{newFinish(new Blob(["new"]));await next;});expect(createUrl).toHaveBeenCalledOnce();expect(f.hook.pending).toBe(false);
 } finally {await f.close();}
});
it.each(["scope","unmount"])("discards late downloads after %s changes",async change=>{
 let finish!:(blob:Blob)=>void,signal!:AbortSignal,pending!:Promise<void>;const f=await fixture();
 await act(async()=>{pending=f.hook.run(s=>{signal=s;return new Promise(resolve=>{finish=resolve;});},"old.zip");});
 if(change==="scope")await f.render("next-account-or-project");else await f.close();
 expect(signal.aborted).toBe(true);
 await act(async()=>{finish(new Blob(["old"]));await pending;});expect(createUrl).not.toHaveBeenCalled();
 if(change==="scope"){expect(f.hook.pending).toBe(false);await f.close();}
});
it("checks the captured account again before releasing the downloaded file",async()=>{
 const guard=vi.fn();vi.spyOn(api,"captureAccountGuard").mockReturnValue(guard);
 let finish!:(blob:Blob)=>void,pending!:Promise<void>;const f=await fixture();
 try {
  await act(async()=>{pending=f.hook.run(()=>new Promise(resolve=>{finish=resolve;}),"backup.zip");});
  guard.mockImplementation(()=>{throw new api.ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});});
  await act(async()=>{finish(new Blob(["secret"]));await pending;});
  expect(createUrl).not.toHaveBeenCalled();expect(f.hook.error).toMatchObject({details:{code:"auth.account_changed"}});expect(f.hook.pending).toBe(false);
 } finally {await f.close();}
});
it.each(["zh-CN","en-US"] as const)("localizes download startup failure and cleans the link and URL in %s",async locale=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{throw new Error("browser detail");});const f=await fixture();
 try {
  await act(async()=>f.hook.run(async()=>new Blob(["csv"]),"report.csv"));
  expect(api.localizedApiError(f.hook.error,i18n.getFixedT(locale))).toBe(locale==="zh-CN"?"无法启动文件下载，请检查浏览器下载设置后重试。":"The file download could not start. Check your browser download settings and try again.");
  expect(revokeUrl).toHaveBeenCalledWith("blob:export");expect(document.querySelector('a[download="report.csv"]')).toBeNull();expect(f.hook.pending).toBe(false);
  click.mockImplementation(()=>{});await act(async()=>f.hook.run(async()=>new Blob(["csv"]),"report.csv"));expect(f.hook.error).toBeUndefined();
 } finally {await f.close();}
});
it("releases a successful download URL after the browser has time to consume it",()=>{
 vi.useFakeTimers();saveExport(new Blob(["csv"]),"report.csv");expect(revokeUrl).not.toHaveBeenCalled();vi.advanceTimersByTime(30_000);expect(revokeUrl).toHaveBeenCalledOnce();
});
