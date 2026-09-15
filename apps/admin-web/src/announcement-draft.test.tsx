// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, adminService, announcementService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { AnnouncementsPage } from "./AnnouncementsPage";
import { OrganizationsPage } from "./OrganizationsPage";
import { closeNoticeDraft, readNoticeDraft, readNoticeSelection, writeNoticeDraft, type NoticeEditor } from "./announcement-draft";
const confirmation=vi.hoisted(()=>vi.fn());
vi.mock("./useConfirm",()=>({useConfirm:()=>confirmation}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{const {transferableAbortController}=await vi.importActual<{transferableAbortController:()=>AbortController}>("node:util");vi.stubGlobal("AbortController",class{constructor(){return transferableAbortController();}});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();confirmation.mockReset();sessionStorage.clear();});
const draft=():NoticeEditor=>({id:crypto.randomUUID(),flowId:crypto.randomUUID(),userId:"owner",organizations:{},content:{title:"Draft",body:"Content",placement:"personal",audience:"specified",languages:[],organizationIds:[],version:0,startsAt:null,endsAt:null,displayDays:30}});
it("rejects foreign, malformed and closed history drafts, including unavailable storage",()=>{
 const editor=draft();const state={announcementEditor:editor};
 expect(readNoticeDraft(state,"owner")).toBe(editor);expect(readNoticeDraft(state,"other")).toBeUndefined();
 expect(readNoticeDraft({announcementEditor:{...editor,content:{...editor.content,organizationIds:[null]}}},"owner")).toBeUndefined();
 expect(readNoticeSelection({announcementSelection:{ids:[1],names:{}}},editor).ids).toEqual([]);
 sessionStorage.setItem(`lw.announcement.closed:${editor.userId}:${editor.flowId}`,"1");expect(readNoticeDraft(state,"owner")).toBeUndefined();
 const second=draft();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("denied");});closeNoticeDraft(second);
 expect(readNoticeDraft({announcementEditor:second},"owner")).toBeUndefined();
});
it("recovers the latest text from tab storage after module reload and removes it on close",async()=>{
 const original=draft();writeNoticeDraft({...original,content:{...original.content,body:"Latest text"}});
 vi.resetModules();const reloaded=await import("./announcement-draft");
 expect(reloaded.readNoticeDraft({announcementEditor:original},"owner")?.content.body).toBe("Latest text");
 expect(reloaded.readNoticeDraft({announcementEditor:original},"other")).toBeUndefined();
 reloaded.closeNoticeDraft(original);expect(sessionStorage.getItem(`lw.announcement.draft:${original.userId}:${original.flowId}`)).toBeNull();
 expect(reloaded.readNoticeDraft({announcementEditor:original},"owner")).toBeUndefined();
});
for(const locale of ["zh-CN","en-US"] as const)it(`preserves editor and picker through Back/remount, cancel, done and save (${locale})`,async()=>{
 await i18n.changeLanguage(locale);confirmation.mockResolvedValue(true);
 vi.spyOn(announcementService,"list").mockResolvedValue({items:[],nextCursor:null} as Awaited<ReturnType<typeof announcementService.list>>);
 vi.spyOn(adminService,"listOrganizations").mockResolvedValue({items:[{id:"org-a",name:"Organization A",active:true,memberCount:2,updatedAt:"2026-09-15T00:00:00Z"},{id:"org-b",name:"Organization B",active:true,memberCount:1,updatedAt:"2026-09-15T00:00:00Z"}],total:2} as Awaited<ReturnType<typeof adminService.listOrganizations>>);
 let finishSave!:(value:Awaited<ReturnType<typeof announcementService.save>>)=>void;
 const save=vi.spyOn(announcementService,"save").mockImplementation(()=>new Promise(resolve=>{finishSave=resolve;}));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const routes=[{path:`/${locale}/settings/announcements`,element:<AnnouncementsPage locale={locale} userId="owner"/>},{path:`/${locale}/organizations`,element:<OrganizationsPage locale={locale} userId="owner"/>}];
 let router=createMemoryRouter(routes,{initialEntries:[`/${locale}/settings/announcements`]});
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 const render=async()=>{await act(async()=>{root.render(<QueryClientProvider client={cache}><RouterProvider key={router.state.location.key} router={router}/></QueryClientProvider>);await settle();});await act(async()=>{await settle();});};
 const button=async(key:string)=>{await act(async()=>{[...c.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===i18n.t(key))!.click();await settle();});await act(async()=>{await settle();});};
 const dispatchChange=(selector:string,value:string)=>{const input=c.querySelector<HTMLInputElement>(selector)!;const proto=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(input,value);input.dispatchEvent(new Event(input.tagName==="SELECT"?"change":"input",{bubbles:true}));};
 const change=async(selector:string,value:string)=>{await act(async()=>dispatchChange(selector,value));};
 const remount=async()=>{const entry=router.state.location;router.dispose();router=createMemoryRouter(routes,{initialEntries:[entry]});await render();};
 try{
  await render();await button("announcements.new");
  const historyKey=router.state.location.key;
  const blockedStorage=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("storage denied");});
  await act(async()=>{for(let n=0;n<150;n++)dispatchChange('.notice-copy-fields textarea',`Input ${n}`);dispatchChange('.notice-copy-fields input','Keep this title');dispatchChange('.notice-copy-fields textarea','Keep this body');});
  expect(router.state.location.key).toBe(historyKey);expect(c.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe("Keep this body");blockedStorage.mockRestore();
  await change('.notice-duration input','45');await change('.notice-pair label:nth-child(2) select','specified');
  await button("announcements.chooseOrgs");await act(async()=>{await router.navigate(-1);});expect(c.querySelector<HTMLInputElement>('.notice-copy-fields input')?.value).toBe("Keep this title");
  await button("announcements.chooseOrgs");await act(async()=>c.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click());
  await change('input[type="search"]','Organization');await act(async()=>c.querySelector('form[role="search"]')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  await remount();expect(c.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.checked).toBe(true);
  await button("announcements.cancel");expect(c.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe("Keep this body");expect(c.querySelector<HTMLInputElement>('.notice-duration input')!.value).toBe("45");expect(router.state.location.state.announcementEditor.content.organizationIds).toEqual([]);
  await button("announcements.chooseOrgs");await act(async()=>{for(const checkbox of c.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'))checkbox.click();});await button("announcements.done");
  await remount();expect(router.state.location.state.announcementEditor.content.organizationIds).toEqual(["org-a","org-b"]);
  const oldState=router.state.location.state;await button("announcements.chooseOrgs");await act(async()=>{await router.navigate(-1);});await button("announcements.save");expect(save).toHaveBeenCalledWith(oldState.announcementEditor.id,expect.objectContaining({title:"Keep this title",body:"Keep this body",displayDays:45,organizationIds:["org-a","org-b"]}));
  await act(async()=>{await router.navigate(1);await settle();});await act(async()=>{await settle();});expect([...c.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every(input=>input.disabled)).toBe(true);expect([...c.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===i18n.t("announcements.done"))!.disabled).toBe(true);await button("announcements.cancel");
  await remount();expect(c.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);expect(save).toHaveBeenCalledTimes(1);
  await act(async()=>{finishSave({} as Awaited<ReturnType<typeof announcementService.save>>);await settle();});await act(async()=>{await settle();});expect(c.querySelector('[role="dialog"]')).toBeNull();
  await act(async()=>{await router.navigate(`/${locale}/settings/announcements`,{state:oldState});});expect(c.querySelector('[role="dialog"]')).toBeNull();
  await button("announcements.new");const discarded=router.state.location.state;await button("announcements.cancel");expect(confirmation).toHaveBeenCalledWith(i18n.t("announcements.unsaved"),false);
  await act(async()=>{await router.navigate(`/${locale}/settings/announcements`,{state:discarded});});expect(c.querySelector('[role="dialog"]')).toBeNull();
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
},15000);

for(const locale of ["zh-CN","en-US"] as const)it.each(["conflict","network"] as const)(`recovers %s saves without overwriting drafts (${locale})`,async mode=>{
 await i18n.changeLanguage(locale);
 const original=draft();original.content={...original.content,audience:"all",version:3,title:undefined,body:undefined,titleZh:"原始标题",titleEn:"Original title",bodyZh:"原始正文",bodyEn:"Original body"};

 vi.spyOn(announcementService,"list").mockResolvedValue({items:[],nextCursor:null} as Awaited<ReturnType<typeof announcementService.list>>);
 const failure=new ApiError({code:mode==="conflict"?"announcement.conflict":"network.error",messageKey:mode==="conflict"?"announcements.conflict":"errors.system.unexpected",retryable:mode==="network"});
 let rejectSave!:(error:unknown)=>void;
 const save=vi.spyOn(announcementService,"save").mockImplementationOnce(()=>mode==="conflict"?new Promise((_resolve,reject)=>{rejectSave=reject;}):Promise.reject(failure)).mockResolvedValue({} as Awaited<ReturnType<typeof announcementService.save>>);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const route=`/${locale}/settings/announcements`;
 const routes=[{path:route,element:<AnnouncementsPage locale={locale} userId="owner"/>}];
 let router=createMemoryRouter(routes,{initialEntries:[{pathname:route,state:{announcementEditor:original}}]});
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 const render=async()=>{await act(async()=>{root.render(<QueryClientProvider client={cache}><RouterProvider key={router.state.location.key} router={router}/></QueryClientProvider>);await settle();});await act(async()=>{await settle();});};
 const button=(key:string)=>[...c.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===i18n.t(key))!;
 const click=async(key:string)=>{await act(async()=>{button(key).click();await settle();});await act(async()=>{await settle();});};
 try{
  await render();await act(async()=>{const input=c.querySelector<HTMLInputElement>('.notice-duration input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"47");input.dispatchEvent(new Event("input",{bubbles:true}));});
  await click("announcements.save");
  if(mode==="conflict"){
   const pendingLocation=router.state.location;router.dispose();router=createMemoryRouter(routes,{initialEntries:[pendingLocation]});await render();
   await act(async()=>{rejectSave(failure);await settle();});await act(async()=>{await settle();});
   await act(async()=>{const input=c.querySelector<HTMLInputElement>('.notice-duration input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"48");input.dispatchEvent(new Event("input",{bubbles:true}));});
   await act(async()=>{cache.getMutationCache().clear();await settle();});
  }
  expect(c.querySelector('textarea')!.value).toBe(locale==="zh-CN"?"原始正文":"Original body");
  expect(save.mock.calls[0][1]).toEqual(expect.objectContaining({version:3,displayDays:47,titleZh:"原始标题",titleEn:"Original title",bodyZh:"原始正文",bodyEn:"Original body"}));expect(save.mock.calls[0][1].title).toBeUndefined();
  if(mode==="network"){
   expect(c.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("announcements.recoveryRetryHint"));expect(button("announcements.recoveryCopy")).toBeUndefined();
   await click("announcements.recoveryRetry");expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  }else{
   expect(button("announcements.save").disabled).toBe(true);expect(c.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("announcements.recoveryConflict"));
   const oldLocation=router.state.location;router.dispose();router=createMemoryRouter(routes,{initialEntries:[oldLocation]});await render();expect(button("announcements.save").disabled).toBe(true);
   confirmation.mockResolvedValueOnce(false);await click("announcements.recoveryCopy");expect(router.state.location.state.announcementEditor.id).toBe(original.id);expect(save).toHaveBeenCalledTimes(1);
   confirmation.mockResolvedValueOnce(true);await click("announcements.recoveryCopy");const recovered=router.state.location.state.announcementEditor;
   expect(recovered.id).not.toBe(original.id);expect(recovered.flowId).not.toBe(original.flowId);expect(recovered.content.version).toBe(0);expect(save).toHaveBeenCalledTimes(1);
   expect(readNoticeDraft({announcementEditor:original},"owner")).toBeUndefined();expect(c.querySelector<HTMLInputElement>('.notice-duration input')!.value).toBe("48");
   const nextLocation=router.state.location;router.dispose();router=createMemoryRouter(routes,{initialEntries:[nextLocation]});await render();await click("announcements.save");
   expect(save.mock.calls[1][0]).toBe(recovered.id);expect(save.mock.calls[1][1]).toEqual({...save.mock.calls[0][1],version:0,displayDays:48});
  }
  expect(c.querySelector('[role="dialog"]')).toBeNull();
 }finally{await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
},15000);
