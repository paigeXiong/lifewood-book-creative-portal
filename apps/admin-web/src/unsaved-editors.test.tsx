// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminService, operationsService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { BackupsPage } from "./BackupsPage";
import { ProjectOperations } from "./ProjectOperations";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let show:PropertyDescriptor|undefined,close:PropertyDescriptor|undefined;
beforeEach(()=>{
 show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(()=>{vi.restoreAllMocks();for(const [name,descriptor] of [["showModal",show],["close",close]] as const){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,name,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,name);}});
for(const locale of ["zh-CN","en-US"] as const)it.each(["backup","deadline"] as const)(`protects changed %s fields and resets on reopening (${locale})`,async kind=>{
 await i18n.changeLanguage(locale);
 vi.spyOn(adminService,"listBackups").mockResolvedValue({items:[],total:0,page:1,pageSize:10,verificationFilters:[],schedule:{policy:{enabled:true,frequency:"daily",dayOfWeek:1,hour:2,timeZoneId:"UTC",retainDays:30,retainCount:5}}} as unknown as Awaited<ReturnType<typeof adminService.listBackups>>);
 vi.spyOn(adminService,"restoreOverview").mockResolvedValue({available:false} as Awaited<ReturnType<typeof adminService.restoreOverview>>);
 vi.spyOn(operationsService,"followup").mockResolvedValue({version:1,dueAt:"2026-09-20T00:00:00Z"} as Awaited<ReturnType<typeof operationsService.followup>>);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const element=kind==="backup"?<BackupsPage locale={locale} userId="owner" allowed/>:<ProjectOperations id="project" locale={locale} permissions={["admin.projects.workflow"]} workflow="new"/>;
 const router=createMemoryRouter([{path:"/",element}]);const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 const open=async()=>{await act(async()=>[...c.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===i18n.t(kind==="backup"?"backups.policy":"operations.editDeadline"))!.click());};
 const cancel=async()=>{await act(async()=>[...c.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item=>item.textContent===i18n.t("common.cancel"))!.click());};
 try {
  await act(async()=>{root.render(<QueryClientProvider client={cache}><RouterProvider router={router}/></QueryClientProvider>);await settle();});await act(async()=>{await settle();});
  await open();await cancel();expect(c.querySelector('[role="dialog"]')).toBeNull();expect(document.querySelector(".app-confirmation")).toBeNull();
  await open();const input=c.querySelector<HTMLInputElement>(kind==="backup"?'input[type="checkbox"]':'input[type="datetime-local"]')!;
  await act(async()=>{if(kind==="backup")input.click();else {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"2026-09-21T10:00");input.dispatchEvent(new Event("input",{bubbles:true}));}});
  const value=kind==="backup"?input.checked:input.value;
  await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(document.querySelector(".app-confirmation p")?.textContent).toBe(i18n.t("common.unsavedConfirm"));
  await act(async()=>document.querySelector<HTMLButtonElement>(".app-confirmation-actions button:first-child")!.click());
  expect(kind==="backup"?input.checked:input.value).toBe(value);expect(input.isConnected).toBe(true);
  await act(async()=>c.querySelector(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
  await act(async()=>document.querySelector<HTMLButtonElement>(".app-confirmation-actions button:last-child")!.click());expect(c.querySelector('[role="dialog"]')).toBeNull();
  await open();await cancel();expect(document.querySelector(".app-confirmation")).toBeNull();expect(c.querySelector('[role="dialog"]')).toBeNull();
 } finally {await act(async()=>root.unmount());router.dispose();cache.clear();c.remove();}
});
