// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { announcementService } from "@lifewood/api-client";
import { Announcements } from "./components/Announcements";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});vi.stubGlobal("IntersectionObserver",class {observe(){}disconnect(){}});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
for(const locale of ["zh-CN","en-US"] as const)it(`offers fresh notices over a cached empty feed and persists close (${locale})`,async()=>{
 await i18n.changeLanguage(locale);const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});
 client.setQueryData(["announcements","account",locale,"new"],{pages:[{items:[],nextCursor:null}],pageParams:[undefined]});
 const item={id:"notice",sequence:1,title:"<img src=x>",body:"A notice",publishedAt:"2026-09-07T00:00:00Z",dismissed:false,popup:true};
 vi.spyOn(announcementService,"feed").mockResolvedValue({items:[item],nextCursor:null});const dismiss=vi.spyOn(announcementService,"dismissMany").mockResolvedValue(undefined);
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try {await act(async()=>{root.render(<QueryClientProvider client={client}><Announcements locale={locale} userId="account"/></QueryClientProvider>);});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
 expect(c.querySelector("dialog")?.open).toBe(true);expect(c.querySelector("article img")).toBeNull();
 await act(async()=>{c.querySelector<HTMLButtonElement>("dialog header button")!.click();});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
 expect(dismiss).toHaveBeenCalledWith(["notice"]);expect(c.querySelector("dialog")?.open).toBe(false);
 }finally{await act(async()=>root.unmount());c.remove();client.clear();}
});
