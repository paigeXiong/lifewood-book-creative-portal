// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminService, announcementService } from "@lifewood/api-client";
import type { AnnouncementDocument } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { AnnouncementsPage } from "./AnnouncementsPage";
import { OrganizationsPage } from "./OrganizationsPage";
import { noticeListSearch, noticeReturnPath, readNoticeListState } from "./announcement-list-state";
vi.mock("./useConfirm",()=>({useConfirm:()=>async()=>true}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{const {transferableAbortController}=await vi.importActual<{transferableAbortController:()=>AbortController}>("node:util");vi.stubGlobal("AbortController",class{constructor(){return transferableAbortController();}});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
const notice=(id:string,title:string):AnnouncementDocument=>({id,sequence:30,createdAt:"2026-09-15T00:00:00Z",status:"draft",version:1,recipients:0,content:{title,body:"Body",placement:"personal",audience:"all",languages:[],organizationIds:[],version:1,startsAt:null,endsAt:null}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
it("validates list state and constructs only a local return route",()=>{
 expect(readNoticeListState("?q=%20hello%20&status=bad&placement=bad&pages=-2")).toEqual({search:"hello",status:"",placement:"",pages:1});
 expect(readNoticeListState("?pages=100000").pages).toBe(50);
 expect(readNoticeListState("?pages=2.5").pages).toBe(1);
 expect(readNoticeListState(`?q=${"x".repeat(200)}`).search).toHaveLength(160);
 expect(noticeReturnPath("en-US","https://bad.example/path?redirect=evil")).toBe("/en-US/settings/announcements");
 expect(noticeListSearch(readNoticeListState("?q=a%26b&pages=2&status=draft"))).toBe("?q=a%26b&status=draft&pages=2");
});
for(const locale of ["zh-CN","en-US"] as const)it(`restores filters and loaded pages through history, organization selection and cold remount (${locale})`,async()=>{
 await i18n.changeLanguage(locale);
 const list=vi.spyOn(announcementService,"list").mockImplementation(async(search,before)=>({items:[notice(before===undefined?"a":before===20?"b":"c",`${search}-${before??30}`)],nextCursor:before===undefined?20:before===20?10:null}));
 vi.spyOn(adminService,"listOrganizations").mockResolvedValue({items:[{id:"org",name:"Organization",active:true,memberCount:1,updatedAt:"2026-09-15T00:00:00Z"}],total:1} as Awaited<ReturnType<typeof adminService.listOrganizations>>);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const path=`/${locale}/settings/announcements`,initial="?q=Alpha&status=draft&placement=personal&pages=2";
 const routes=[{path,element:<AnnouncementsPage locale={locale} userId="owner"/>},{path:`/${locale}/organizations`,element:<OrganizationsPage locale={locale} userId="owner"/>}];
 let router=createMemoryRouter(routes,{initialEntries:[path+initial]});const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const render=async()=>{await act(async()=>{root.render(<QueryClientProvider client={cache}><RouterProvider key={router.state.location.key} router={router}/></QueryClientProvider>);await settle();});await act(async()=>{await settle();});await act(async()=>{await settle();});};
 const click=async(key:string)=>{await act(async()=>{[...c.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===i18n.t(key))!.click();await settle();});await act(async()=>{await settle();});};
 const change=async(selector:string,value:string)=>{await act(async()=>{const input=c.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event(input.tagName==="SELECT"?"change":"input",{bubbles:true}));});};
 try{
  await render();expect(c.querySelectorAll("tbody tr")).toHaveLength(2);expect(list).toHaveBeenCalledWith("Alpha",20,"draft","personal");
  await click("announcements.more");expect(router.state.location.search).toContain("pages=3");expect(c.querySelectorAll("tbody tr")).toHaveLength(3);
  await act(async()=>{await router.navigate(-1);});expect(c.querySelectorAll("tbody tr")).toHaveLength(2);
  await act(async()=>{await router.navigate(1);});expect(c.querySelectorAll("tbody tr")).toHaveLength(3);
  const beforeTyping=router.state.location.key;await change('input[name="q"]',"Beta");expect(router.state.location.key).toBe(beforeTyping);
  await click("common.search");expect(router.state.location.search).toBe("?q=Beta&status=draft&placement=personal");expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
  await change('.page-toolbar > select',"published");await act(async()=>{await settle();});expect(list).toHaveBeenLastCalledWith("Beta",undefined,"published","personal");
  await change('.page-toolbar > select:nth-of-type(2)',"login");await act(async()=>{await settle();});expect(list).toHaveBeenLastCalledWith("Beta",undefined,"published","login");
  await act(async()=>{await router.navigate(-1);});await act(async()=>{await router.navigate(-1);});
  await act(async()=>{await router.navigate(-1);});await act(async()=>{await settle();});expect(c.querySelector<HTMLInputElement>('input[name="q"]')!.value).toBe("Alpha");expect(c.querySelectorAll("tbody tr")).toHaveLength(3);
  const retained=router.state.location.search;
  await click("announcements.edit");await change('.notice-pair label:nth-child(2) select',"specified");await click("announcements.chooseOrgs");await click("announcements.cancel");expect(router.state.location.search).toBe(retained);
  await click("announcements.chooseOrgs");await act(async()=>c.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click());await click("announcements.done");expect(router.state.location.search).toBe(retained);
  await click("announcements.cancel");expect(c.querySelectorAll("tbody tr")).toHaveLength(3);
  const entry=router.state.location;await act(async()=>root.render(null));router.dispose();cache.clear();list.mockClear();router=createMemoryRouter(routes,{initialEntries:[entry]});await render();await act(async()=>{await settle();});
  expect(c.querySelectorAll("tbody tr")).toHaveLength(3);expect(list.mock.calls.map(call=>call[1])).toEqual([undefined,20,10]);
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
},15000);

it("does not navigate back to an old list when load-more finishes after leaving",async()=>{
 await i18n.changeLanguage("en-US");let finish!:(page:Awaited<ReturnType<typeof announcementService.list>>)=>void;
 vi.spyOn(announcementService,"list").mockImplementation(async(_search,before)=>before===undefined?{items:[notice("a","First")],nextCursor:20}:new Promise(resolve=>{finish=resolve;}));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),c=document.createElement("div"),root=createRoot(c);document.body.append(c);
 const router=createMemoryRouter([{path:"/en-US/settings/announcements",element:<AnnouncementsPage locale="en-US" userId="owner"/>},{path:"/other",element:<p>Other</p>}],{initialEntries:["/en-US/settings/announcements"]});
 try{
  await act(async()=>{root.render(<QueryClientProvider client={cache}><RouterProvider router={router}/></QueryClientProvider>);await settle();});await act(async()=>{await settle();});
  await act(async()=>{[...c.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===i18n.t("announcements.more"))!.click();await settle();});
  await act(async()=>{await router.navigate("/other");});await act(async()=>{finish({items:[notice("b","Second")],nextCursor:null});await settle();});expect(router.state.location.pathname).toBe("/other");
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
});

it.each([1,3])("keeps the URL stable on page-load failure and recovers after refresh (pages=%s)",async pages=>{
 await i18n.changeLanguage("en-US");let fail=true;
 vi.spyOn(announcementService,"list").mockImplementation(async(_search,before)=>{if(before===20&&fail){fail=false;throw new Error("offline");}return {items:[notice(before===undefined?"a":before===20?"b":"c","Title")],nextCursor:before===undefined?20:before===20?10:null};});
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),c=document.createElement("div"),root=createRoot(c);document.body.append(c);
 const path="/en-US/settings/announcements",search=pages===1?"":`?pages=${pages}`;
 const router=createMemoryRouter([{path,element:<AnnouncementsPage locale="en-US" userId="owner"/>}],{initialEntries:[path+search]});
 const flush=async()=>{for(let n=0;n<4;n++)await act(async()=>{await settle();});};
 const click=async(key:string)=>{await act(async()=>[...c.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===i18n.t(key))!.click());await flush();};
 try{
  await act(async()=>root.render(<QueryClientProvider client={cache}><RouterProvider router={router}/></QueryClientProvider>));await flush();if(pages===1)await click("announcements.more");
  expect(router.state.location.search).toBe(search);expect(c.querySelector('[role="alert"]')).not.toBeNull();expect(c.querySelectorAll('tbody tr')).toHaveLength(1);
  await click("announcements.refresh");expect(c.querySelector('[role="alert"]')).toBeNull();
  if(pages===1){await click("announcements.more");expect(router.state.location.search).toBe("?pages=2");}
  expect(c.querySelectorAll('tbody tr')).toHaveLength(pages===1?2:3);
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
});

it.each(["refresh","back"] as const)("ignores stale load-more completion after %s without changing history",async mode=>{
 await i18n.changeLanguage("en-US");let finish!:(page:Awaited<ReturnType<typeof announcementService.list>>)=>void;
 vi.spyOn(announcementService,"list").mockImplementation(async(search,before)=>before===undefined?{items:[notice("a",search||"First")],nextCursor:20}:new Promise(resolve=>{finish=resolve;}));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),c=document.createElement("div"),root=createRoot(c);document.body.append(c);
 const path="/en-US/settings/announcements";const router=createMemoryRouter([{path,element:<AnnouncementsPage locale="en-US" userId="owner"/>}],{initialEntries:[path]});
 const flush=async()=>{for(let n=0;n<3;n++)await act(async()=>{await settle();});};
 const click=async(key:string)=>{await act(async()=>[...c.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===i18n.t(key))!.click());await flush();};
 try{
  await act(async()=>root.render(<QueryClientProvider client={cache}><RouterProvider router={router}/></QueryClientProvider>));await flush();await click("announcements.more");
  if(mode==="refresh")await click("announcements.refresh");
  else {await act(async()=>{await router.navigate(path+"?q=B");});await flush();await act(async()=>{await router.navigate(-1);});await flush();}
  await act(async()=>{finish({items:[notice("b","Second")],nextCursor:null});await settle();});await flush();
  expect(router.state.location.search).toBe("");expect(c.querySelectorAll('tbody tr')).toHaveLength(1);
  if(mode==="back"){await act(async()=>{await router.navigate(1);});expect(router.state.location.search).toBe("?q=B");}
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
});
