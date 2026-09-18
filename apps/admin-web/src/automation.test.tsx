// @vitest-environment jsdom
import {transferableAbortController} from "node:util";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter, createMemoryRouter, RouterProvider} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {adminService,announcementService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import "./i18n";
import {AutomationPage} from "./AutomationPage";
import {AnnouncementsPage} from "./AnnouncementsPage";
import {AnnouncementScheduleDialog} from "./AnnouncementScheduleDialog";
import type {AnnouncementDocument} from "@lifewood/domain";
vi.mock("./useConfirm",()=>({useConfirm:()=>async()=>true}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>vi.stubGlobal("AbortController",class {constructor(){return transferableAbortController();}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
for(const locale of ["zh-CN","en-US"] as const) {
 it(`limits backup controls to owners and shows durable task history (${locale})`,async()=>{
  await i18n.changeLanguage(locale);
  vi.spyOn(announcementService,"jobs").mockResolvedValue({items:[{id:"job",announcementId:"notice",title:"Scheduled notice",status:"pending",runAt:"2027-01-01T00:00:00Z"}],page:1,total:1,pending:1,nextRunAt:"2027-01-01T00:00:00Z"});
  const backups=vi.spyOn(adminService,"listBackups").mockResolvedValue({items:[],page:1,pageSize:20,total:0,schedule:{policy:{enabled:false,frequency:"daily",hour:2,dayOfWeek:0,timeZoneId:"UTC",retainDays:30,retainCount:10},nextRunAt:undefined},current:undefined,paused:false});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
  try {
   const render=async(allowed:boolean)=>{await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter><AutomationPage locale={locale} userId="staff" canBackup={allowed}/></MemoryRouter></QueryClientProvider>));await act(async()=>{await new Promise(r=>setTimeout(r,30));});};
   await render(false);expect(c.textContent).toContain("Scheduled notice");expect(c.querySelector('a[href$="settings/backups"]')).toBeNull();expect(backups).not.toHaveBeenCalled();
   await render(true);expect(c.querySelector('a[href$="settings/backups"]')).not.toBeNull();expect(backups).toHaveBeenCalled();
  } finally {await act(async()=>root.unmount());c.remove();client.clear();}
 });
 it(`submits a local schedule as UTC and retains input after failure (${locale})`,async()=>{
  await i18n.changeLanguage(locale);
  const item:AnnouncementDocument={id:"notice",sequence:1,status:"draft",version:3,createdAt:"2026-09-18T00:00:00Z",recipients:0,content:{title:"Title",body:"Body",placement:"banner",audience:"all",languages:[],organizationIds:[],startsAt:null,endsAt:null,version:3}};
  const schedule=vi.spyOn(announcementService,"schedule").mockRejectedValue(new Error("offline"));
  const saved=vi.fn();const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
  try {
   await act(async()=>root.render(<QueryClientProvider client={client}><RouterProvider router={createMemoryRouter([{path:"/",element:<AnnouncementScheduleDialog item={item} locale={locale} onClose={()=>{}} onSaved={saved}/> }])}/></QueryClientProvider>));
   const time=new Date(Date.now()+3600000);const local=new Date(time.getTime()-time.getTimezoneOffset()*60000).toISOString().slice(0,16);
   const input=document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
   await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,local);input.dispatchEvent(new Event("input",{bubbles:true}));});
   await act(async()=>document.querySelector('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
   await act(async()=>{await new Promise(r=>setTimeout(r,30));});
   expect(schedule).toHaveBeenCalledWith("notice",3,new Date(local).toISOString());expect(input.value).toBe(local);expect(saved).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')).not.toBeNull();
  } finally {await act(async()=>root.unmount());c.remove();client.clear();}
 });
}

for(const locale of ["zh-CN","en-US"] as const) it(`creates a scheduled announcement from the task entry (${locale})`,async()=>{
 await i18n.changeLanguage(locale);vi.spyOn(announcementService,"list").mockResolvedValue({items:[],nextCursor:null});
 const save=vi.spyOn(announcementService,"save").mockImplementation(async(id,content)=>({id,content,sequence:1,status:"draft",version:1,createdAt:new Date().toISOString(),recipients:0}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const router=createMemoryRouter([{path:"/:locale/announcements",element:<AnnouncementsPage locale={locale} userId="owner"/>}],{initialEntries:[`/${locale}/announcements?create=scheduled`]});
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try {
  await act(async()=>root.render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>));
  await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  expect(router.state.location.search).toBe("");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(i18n.t("automation.saveAndSchedule"));
  for(const [selector,value] of [[".notice-copy-fields input","Notice"],[".notice-copy-fields textarea","Body"]]) {
   const input=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;
   await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
  }
  await act(async()=>document.querySelector('.notice-editor form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  expect(save).toHaveBeenCalledTimes(1);
  expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull();
  expect(document.querySelector('.notice-copy-fields')).toBeNull();
 } finally {await act(async()=>root.unmount());c.remove();client.clear();router.dispose();}
});
