import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter,Routes,Route,useNavigate,type NavigateFunction} from "react-router-dom";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {notificationService as service,type NotificationItem} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import {NotificationCenter} from "@lifewood/ui/notifications";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,client:QueryClient;
let navigate:NavigateFunction;
function Center({compact,admin}:{compact:boolean;admin:boolean}){navigate=useNavigate();return <NotificationCenter compact={compact} admin={admin}/>;}
const item:NotificationItem={id:7,kind:"workflow",projectId:"project",projectTitle:"Book",actor:"Editor",createdAt:"2026-09-14T00:00:00Z",read:false,archived:false,state:"info",targetId:"",title:"Book updated",level:"normal"};
const page=(items:NotificationItem[]=[])=>({items,nextCursor:null,unread:items.length,watermark:42});
const settle=async(ms=35)=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});};
beforeEach(()=>{
 vi.spyOn(service,"catalog").mockResolvedValue({retentionDays:365,items:[]});
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());client?.clear();host?.remove();vi.restoreAllMocks();delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;});
async function mount(locale:string,admin=false,compact=false){
 await i18n.changeLanguage(locale);client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
 client.setQueryData([admin?"admin-me":"current-user"],{id:"account"});host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications`]}><Routes><Route path="/:locale/*" element={<Center admin={admin} compact={compact}/>}/></Routes></MemoryRouter></QueryClientProvider>));await settle();
}
function button(key:string){return host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`)!;}
async function change(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));});}
for(const locale of ["zh-CN","en-US"]){
 it(`keeps failed, empty and filtered-empty results distinct (${locale})`,async()=>{
  const list=vi.spyOn(service,"list").mockRejectedValue(new Error("offline"));await mount(locale);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain(i18n.t("notifications.empty"));
  list.mockResolvedValue(page());await act(async()=>button("common.retry").click());await settle();expect(host.textContent).toContain(i18n.t("notifications.empty"));
  const search=host.querySelector<HTMLInputElement>('input[type="search"]')!;const before=list.mock.calls.length;
  await change(search,"book");expect(list.mock.calls.length).toBe(before);await settle(340);await settle();
  expect(list).toHaveBeenLastCalledWith(locale,expect.objectContaining({search:"book"}),undefined);expect(host.textContent).toContain(i18n.t("notifications.noResults"));
  await act(async()=>button("notifications.clearFilters").click());await settle();expect(search.value).toBe("");expect(host.textContent).toContain(i18n.t("notifications.empty"));
 });
 it(`blocks invalid date ranges and clears every filter in admin too (${locale})`,async()=>{
  const list=vi.spyOn(service,"list").mockResolvedValue(page());await mount(locale,true);
  const dates=host.querySelectorAll<HTMLInputElement>('input[type="date"]');await change(dates[0],"2026-09-14");await settle();const count=list.mock.calls.length;
  await change(dates[1],"2026-09-13");await settle();expect(list.mock.calls.length).toBe(count);expect(host.textContent).toContain(i18n.t("notifications.invalidDates"));expect(button("notifications.refresh").disabled).toBe(true);
  expect(host.textContent).not.toContain(i18n.t("notifications.empty"));
  await act(async()=>button("notifications.clearFilters").click());await settle();expect(dates[0].value).toBe("");expect(dates[1].value).toBe("");expect(host.textContent).not.toContain(i18n.t("notifications.invalidDates"));
  await change(dates[0],"2026-09-14");await change(dates[1],"2026-09-15");await settle();expect(list.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({from:expect.stringContaining("2026-09-"),to:expect.stringContaining("2026-09-")}));expect(button("notifications.refresh").disabled).toBe(false);
 });
 it(`confirms global read scope and keeps selected reads scoped to IDs (${locale})`,async()=>{
  vi.spyOn(service,"list").mockResolvedValue(page([item]));const update=vi.spyOn(service,"update").mockResolvedValue(undefined);await mount(locale);
  await change(host.querySelector<HTMLInputElement>('input[type="search"]')!,"book");await settle(340);await settle();
  await act(async()=>button("notifications.enterSelection").click());await act(async()=>button("notifications.readAll").click());
  expect(document.querySelector('.app-confirmation')?.textContent).toContain(i18n.t("notifications.readAllConfirm"));expect(update).not.toHaveBeenCalled();
  await act(async()=>document.querySelector<HTMLButtonElement>('.app-confirmation-actions button')!.click());await settle();expect(update).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLInputElement>('.notification-list input[type="checkbox"]')!.click());await act(async()=>button("notifications.readSelected").click());await settle();expect(update).toHaveBeenLastCalledWith("read",[7],undefined);
  await act(async()=>button("notifications.enterSelection").click());await act(async()=>button("notifications.readAll").click());await act(async()=>document.querySelector<HTMLButtonElement>('.app-confirmation-actions button:last-child')!.click());await settle();expect(update).toHaveBeenLastCalledWith("read",undefined,42);
 });
}
it('does not apply a global confirmation after the account changes',async()=>{
 vi.spyOn(service,"list").mockResolvedValue(page([item]));const update=vi.spyOn(service,"update").mockResolvedValue(undefined);await mount("en-US");
 await act(async()=>button("notifications.enterSelection").click());await act(async()=>button("notifications.readAll").click());
 await act(async()=>client.setQueryData(["current-user"],{id:"another-account"}));await settle();
 expect(document.querySelector('.app-confirmation')).toBeNull();expect(update).not.toHaveBeenCalled();
});
for(const locale of ["zh-CN","en-US"])for(const cause of ["history","account-event"]){
 it(`closes a compact center's real confirmation on ${cause} (${locale})`,async()=>{
  vi.spyOn(service,"list").mockResolvedValue(page([item]));const update=vi.spyOn(service,"update").mockResolvedValue(undefined);await mount(locale,false,true);
  await act(async()=>button("notifications.enterSelection").click());await act(async()=>button("notifications.readAll").click());
  const oldAccept=document.querySelector<HTMLButtonElement>('.app-confirmation-actions button:last-child')!;expect(oldAccept).not.toBeNull();
  await act(async()=>{if(cause==="history")navigate(`/${locale}/tasks`);else window.dispatchEvent(new Event("lw-account-changed"));});await settle();
  expect(document.querySelector('.app-confirmation')).toBeNull();expect(document.body.style.overflow).not.toBe("hidden");
  await act(async()=>oldAccept.click());expect(update).not.toHaveBeenCalled();
  expect(client.getMutationCache().findAll({mutationKey:["notification-action"],status:"pending"})).toHaveLength(0);
 });
}
