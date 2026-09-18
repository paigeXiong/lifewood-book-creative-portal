// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { announcementService } from "@lifewood/api-client";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
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

for (const locale of ["zh-CN","en-US"] as const) it(`shows a scrolling banner, preserves it on detail close and retries account dismissal (${locale})`, async () => {
 await i18n.changeLanguage(locale);
 const item={id:"banner",sequence:2,title:"Maintenance",body:"Details\nSecond line",publishedAt:"2026-09-18T00:00:00Z",dismissed:false,popup:false,banner:true};
 const feed=vi.spyOn(announcementService,"banner").mockResolvedValue({items:[item],nextCursor:null});
 vi.spyOn(announcementService,"feed").mockResolvedValue({items:[item],nextCursor:null});
 const many=vi.spyOn(announcementService,"dismissMany").mockResolvedValue(undefined);
 const dismiss=vi.spyOn(announcementService,"dismiss").mockRejectedValueOnce(new Error("offline")).mockImplementation(async()=>{feed.mockResolvedValue({items:[],nextCursor:null});});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
 try {
  await act(async()=>root.render(<QueryClientProvider client={client}><AnnouncementBanner locale={locale} userId="one"/></QueryClientProvider>));await settle();
  expect(c.querySelector(".portal-announcement-title")?.getAttribute("aria-label")).toBe("Maintenance · Details Second line");
  expect([...c.querySelectorAll("dialog")].some(d=>d.open)).toBe(false);
  await act(async()=>c.querySelector<HTMLButtonElement>(".portal-announcement-title")!.click());
  expect(c.querySelector("dialog[open] article")?.textContent).toContain("Details");
  await act(async()=>c.querySelector<HTMLButtonElement>("dialog[open] header button")!.click());
  expect(dismiss).not.toHaveBeenCalled();
  await act(async()=>c.querySelector<HTMLButtonElement>(".announcement-entry")!.click());await settle();
  await act(async()=>c.querySelector<HTMLButtonElement>("dialog[open] header button")!.click());await settle();
  expect(many).not.toHaveBeenCalled();expect(dismiss).not.toHaveBeenCalled();
  await act(async()=>c.querySelector<HTMLButtonElement>(".portal-announcement-dismiss:not(.portal-announcement-pause)")!.click());await settle();
  expect(c.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("announcements.bannerCloseFailed"));
  expect(c.querySelector(".portal-announcement-banner")).not.toBeNull();
  await act(async()=>c.querySelector<HTMLButtonElement>(".portal-announcement-dismiss:not(.portal-announcement-pause)")!.click());await settle();
  expect(dismiss).toHaveBeenCalledWith("banner");expect(c.querySelector(".portal-announcement-banner")).toBeNull();
 } finally {await act(async()=>root.unmount());c.remove();client.clear();}
});
