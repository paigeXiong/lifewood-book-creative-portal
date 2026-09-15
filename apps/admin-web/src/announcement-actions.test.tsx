// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "@lifewood/api-client";
import type { AnnouncementDocument } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { AnnouncementsPage } from "./AnnouncementsPage";
import { useAnnouncementActions } from "./useAnnouncementActions";
const confirmation=vi.hoisted(()=>vi.fn());
vi.mock("./useConfirm",()=>({useConfirm:()=>confirmation}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.restoreAllMocks();confirmation.mockReset();});
const notice=(status:AnnouncementDocument["status"]="draft",version=3):AnnouncementDocument=>({id:"a",sequence:1,createdAt:"2026-09-15T00:00:00Z",status,version,content:{title:"Test notice",body:"Body",placement:"personal",languages:[],organizationIds:[],audience:"all",version,startsAt:null,endsAt:null},recipients:0});
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
for(const locale of ["zh-CN","en-US"] as const)for(const action of ["publish","withdraw","delete"] as const)it(`refreshes uncertain ${action} results without claiming success (${locale})`,async()=>{
 await i18n.changeLanguage(locale);confirmation.mockResolvedValue(true);
 let rows=[notice(action==="withdraw"?"published":"draft")];
 vi.spyOn(api.announcementService,"list").mockImplementation(async()=>({items:rows,nextCursor:null}));
 const preview=vi.spyOn(api.announcementService,"preview").mockResolvedValue({count:8});
 const error=new api.ApiError({code:"network.error",messageKey:"errors.system.unexpected",retryable:true});
 const transition=vi.spyOn(api.announcementService,"transition").mockImplementation(async()=>{rows=[notice(action==="publish"?"published":"withdrawn",4)];throw error;});
 const remove=vi.spyOn(api.announcementService,"deleteDraft").mockImplementation(async()=>{rows=[];throw error;});
 const toast=vi.fn();window.addEventListener("lifewood:admin-toast",toast);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>{root.render(<QueryClientProvider client={cache}><MemoryRouter><AnnouncementsPage locale={locale} userId="owner"/></MemoryRouter></QueryClientProvider>);await settle();});await act(async()=>{await settle();});
  const button=[...c.querySelectorAll<HTMLButtonElement>('tbody button')].find(b=>b.textContent===i18n.t(action==="delete"?"announcements.deleteDraft":`announcements.${action}`))!;
  await act(async()=>{button.click();button.click();await settle();});await act(async()=>{await settle();});
  expect(confirmation).toHaveBeenCalledTimes(1);expect(action==="delete"?remove:transition).toHaveBeenCalledTimes(1);expect(preview).toHaveBeenCalledTimes(action==="publish"?1:0);
  expect(c.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("announcements.actionUnknown"));expect(toast).not.toHaveBeenCalled();
  if(action==="delete")expect(c.querySelectorAll('tbody tr')).toHaveLength(0);else expect(c.querySelector('tbody')!.textContent).toContain(i18n.t(action==="publish"?"announcements.published":"announcements.withdrawn"));
 }finally{await act(async()=>root.unmount());cache.clear();c.remove();window.removeEventListener("lifewood:admin-toast",toast);}
});

for(const locale of ["zh-CN","en-US"] as const)it(`locks confirmation, refreshes conflicts and requires a fresh publish preview (${locale})`,async()=>{
 await i18n.changeLanguage(locale);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const refresh=vi.fn().mockResolvedValue(undefined);let state!:ReturnType<typeof useAnnouncementActions>;
 function Harness(){state=useAnnouncementActions("owner",locale,refresh);return null;}
 let resolveConfirm!:(value:boolean)=>void;confirmation.mockImplementationOnce(()=>new Promise(resolve=>{resolveConfirm=resolve;})).mockResolvedValue(true);
 const preview=vi.spyOn(api.announcementService,"preview").mockResolvedValue({count:5});
 const transition=vi.spyOn(api.announcementService,"transition").mockRejectedValueOnce(new api.ApiError({code:"announcement.conflict",messageKey:"announcements.conflict",retryable:false})).mockResolvedValue(notice("published",5));
 try{
  await act(async()=>root.render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>));
  await act(async()=>{state.run(notice(),"publish");state.run(notice(),"delete");await settle();});expect(state.busy).toBe(true);expect(confirmation).toHaveBeenCalledTimes(1);expect(transition).not.toHaveBeenCalled();
  await act(async()=>{resolveConfirm(true);await settle();});await act(async()=>{await settle();});expect(state.failure?.hint).toBe("actionConflict");expect(refresh).toHaveBeenCalledTimes(1);
  await act(async()=>{state.run(notice("draft",4),"publish");await settle();});await act(async()=>{await settle();});expect(preview.mock.calls).toEqual([["a",3],["a",4]]);expect(transition.mock.calls).toEqual([["a",3,"publish"],["a",4,"publish"]]);expect(state.failure).toBeUndefined();
 }finally{await act(async()=>root.unmount());cache.clear();c.remove();}
});

it.each(["unmount","account"] as const)("does not execute a late confirmation after %s",async mode=>{
 const cache=new QueryClient(),c=document.createElement("div"),root=createRoot(c);let state!:ReturnType<typeof useAnnouncementActions>;let changed=false;
 vi.spyOn(api,"captureAccountGuard").mockReturnValue(()=>{if(changed)throw new api.ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});});
 function Harness(){state=useAnnouncementActions("owner","en-US",async()=>{});return null;}
 let resolve!:(value:boolean)=>void;confirmation.mockImplementation(()=>new Promise(r=>{resolve=r;}));const remove=vi.spyOn(api.announcementService,"deleteDraft").mockResolvedValue();
 try{await act(async()=>root.render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>));await act(async()=>{state.run(notice(),"delete");await settle();});
  if(mode==="unmount")await act(async()=>root.render(null));else changed=true;
  await act(async()=>{resolve(true);await settle();});expect(remove).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());cache.clear();}
});

it("keeps an in-flight write locked after remount and refreshes its result",async()=>{
 const cache=new QueryClient(),c=document.createElement("div"),root=createRoot(c);let state!:ReturnType<typeof useAnnouncementActions>;const refresh=vi.fn().mockResolvedValue(undefined);
 function Harness(){state=useAnnouncementActions("owner","en-US",refresh);return null;}
 let finish!:()=>void;confirmation.mockResolvedValue(true);const remove=vi.spyOn(api.announcementService,"deleteDraft").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 try{await act(async()=>root.render(<QueryClientProvider client={cache}><Harness key="one"/></QueryClientProvider>));await act(async()=>{state.run(notice(),"delete");await settle();});
  await act(async()=>root.render(<QueryClientProvider client={cache}><Harness key="two"/></QueryClientProvider>));expect(state.busy).toBe(true);await act(async()=>state.run(notice(),"delete"));expect(remove).toHaveBeenCalledTimes(1);
  await act(async()=>{finish();await settle();});await act(async()=>{await settle();});expect(refresh).toHaveBeenCalledTimes(1);expect(state.busy).toBe(false);
 }finally{await act(async()=>root.unmount());cache.clear();}
});

for(const locale of ["zh-CN","en-US"] as const)it(`blocks stale actions after a missing preview and failed refresh (${locale})`,async()=>{
 await i18n.changeLanguage(locale);const cache=new QueryClient(),c=document.createElement("div"),root=createRoot(c);let state!:ReturnType<typeof useAnnouncementActions>;
 const refresh=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
 function Harness(){state=useAnnouncementActions("owner",locale,refresh);return null;}
 const preview=vi.spyOn(api.announcementService,"preview").mockRejectedValueOnce(new api.ApiError({code:"announcement.missing",messageKey:"announcements.conflict",retryable:false})).mockResolvedValue({count:2});
 const transition=vi.spyOn(api.announcementService,"transition").mockResolvedValue(notice("published",4));confirmation.mockResolvedValue(true);
 try{
  await act(async()=>root.render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>));await act(async()=>{state.run(notice(),"publish");await settle();});await act(async()=>{await settle();});
  expect(state.failure?.hint).toBe("actionMissing");expect(state.refreshFailed).toBe(true);expect(confirmation).not.toHaveBeenCalled();expect(transition).not.toHaveBeenCalled();
  await act(async()=>state.run(notice(),"publish"));expect(preview).toHaveBeenCalledTimes(1);
  await act(async()=>{await state.refresh();});expect(state.refreshFailed).toBe(false);expect(state.failure).toBeUndefined();
  await act(async()=>{state.run(notice(),"publish");await settle();});await act(async()=>{await settle();});expect(preview).toHaveBeenCalledTimes(2);expect(transition).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>root.unmount());cache.clear();}
});

it("releases the action lock when confirmation fails or is cancelled",async()=>{
 const cache=new QueryClient(),c=document.createElement("div"),root=createRoot(c);let state!:ReturnType<typeof useAnnouncementActions>;const refresh=vi.fn().mockResolvedValue(undefined);
 function Harness(){state=useAnnouncementActions("owner","en-US",refresh);return null;}
 confirmation.mockRejectedValueOnce(new Error("dialog failed")).mockResolvedValueOnce(false).mockResolvedValue(true);const remove=vi.spyOn(api.announcementService,"deleteDraft").mockResolvedValue();
 try{await act(async()=>root.render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>));
  for(let index=0;index<2;index++){await act(async()=>{state.run(notice(),"delete");await settle();});await act(async()=>{await settle();});expect(state.busy).toBe(false);expect(remove).not.toHaveBeenCalled();}
  await act(async()=>{state.run(notice(),"delete");await settle();});await act(async()=>{await settle();});expect(remove).toHaveBeenCalledTimes(1);expect(refresh).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>root.unmount());cache.clear();}
});
