import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, notificationService as service, type NotificationItem } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { NotificationCenter } from "@lifewood/ui/notifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const item: NotificationItem = { id: 7, kind: "workflow", projectId: "book", projectTitle: "Book", actor: "Editor", createdAt: "2026-09-14T00:00:00Z", read: false, archived: false, state: "info", targetId: "", title: "Book updated", level: "normal" };
let host: HTMLDivElement, root: Root, client: QueryClient;
let show: PropertyDescriptor | undefined, close: PropertyDescriptor | undefined;
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function Path() { return <output data-path>{useLocation().pathname}</output>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const button = (key: string, scope: ParentNode = host) => scope.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`)!;

beforeEach(() => {
 show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
 vi.spyOn(service,"catalog").mockResolvedValue({retentionDays:365,items:[]});
 vi.spyOn(service,"list").mockResolvedValue({items:[item],nextCursor:null,unread:1,watermark:7});
 vi.spyOn(service,"update").mockResolvedValue(undefined);
});
afterEach(async () => {
 if(root)await act(async()=>root.unmount());client?.clear();host?.remove();vi.restoreAllMocks();
 for(const [name,descriptor] of [["showModal",show],["close",close]] as const){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,name,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,name);}
});
async function mount(locale: string, admin: boolean) {
 await i18n.changeLanguage(locale);client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
 client.setQueryData([admin?"admin-me":"current-user"],{id:"customer"});host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications`]}><Path/><Routes><Route path="/:locale/notifications" element={<NotificationCenter admin={admin}/>}/><Route path="/:locale/tasks/book" element={<p>Project destination</p>}/></Routes></MemoryRouter></QueryClientProvider>));await settle();
}
for(const locale of ["zh-CN","en-US"])for(const admin of [false,true]){
 it(`shows target and read failures inside the detail dialog, with retry (${locale}, admin=${admin})`,async()=>{
  const target=vi.spyOn(service,"target").mockRejectedValue(new ApiError({code:"network.unavailable",messageKey:"errors.network.unavailable",retryable:true}));
  await mount(locale,admin);await act(async()=>button("notifications.details").click());await settle();
  const dialog=host.querySelector("dialog")!;
  await act(async()=>button("notifications.openProject",dialog).click());
  expect(dialog.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("errors.network.unavailable"));
  expect(host.querySelector('[data-path]')!.textContent).toBe(`/${locale}/notifications`);
  target.mockResolvedValue({path:`/${locale}/tasks/book`});
  vi.mocked(service.update).mockRejectedValueOnce(new ApiError({code:"auth.unauthorized",messageKey:"errors.auth.unauthorized",retryable:false}));
  await act(async()=>button("notifications.openProject",dialog).click());
  expect(dialog.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("errors.auth.unauthorized"));
  await act(async()=>button("notifications.openProject",dialog).click());
  expect(host.textContent).toContain("Project destination");expect(host.querySelector("dialog")).toBeNull();
 });
 it(`blocks duplicate navigation and ignores a closed dialog's late response (${locale}, admin=${admin})`,async()=>{
  const pending=deferred<{path:string}>();const target=vi.spyOn(service,"target").mockReturnValue(pending.promise);
  await mount(locale,admin);await act(async()=>button("notifications.details").click());await settle();
  const dialog=host.querySelector("dialog")!;const update=vi.mocked(service.update);update.mockClear();
  await act(async()=>{const open=button("notifications.openProject",dialog);open.click();open.click();});
  expect(target).toHaveBeenCalledTimes(1);expect(button("notifications.openProject",dialog).disabled).toBe(true);
  const signal=target.mock.calls[0][3]!;await act(async()=>button("common.close",dialog).click());expect(signal.aborted).toBe(true);
  await act(async()=>pending.resolve({path:`/${locale}/tasks/book`}));
  expect(update).not.toHaveBeenCalled();expect(host.querySelector('[data-path]')!.textContent).toBe(`/${locale}/notifications`);
 });
 it(`ignores navigation after account replacement, including a pending read request (${locale}, admin=${admin})`,async()=>{
  vi.spyOn(service,"target").mockResolvedValue({path:`/${locale}/tasks/book`});await mount(locale,admin);
  const pending=deferred<void>();vi.mocked(service.update).mockReturnValueOnce(pending.promise);
  await act(async()=>button("notifications.openProject").click());
  const signal=vi.mocked(service.update).mock.calls[0][3]!;
  await act(async()=>client.setQueryData([admin?"admin-me":"current-user"],{id:"other-user"}));await settle();
  expect(signal.aborted).toBe(true);await act(async()=>pending.resolve());
  expect(host.querySelector('[data-path]')!.textContent).toBe(`/${locale}/notifications`);
 });
}

for(const phase of ["target","read"] as const){
 it(`stops a pending ${phase} on the cross-tab account event before cached identity changes`,async()=>{
  const targetResult=deferred<{path:string}>(),readResult=deferred<void>();
  const target=vi.spyOn(service,"target").mockImplementation(()=>phase==="target"?targetResult.promise:Promise.resolve({path:"/en-US/tasks/book"}));
  await mount("en-US",false);
  if(phase==="read")vi.mocked(service.update).mockReturnValueOnce(readResult.promise);
  await act(async()=>button("notifications.openProject").click());
  const signal=phase==="target"?target.mock.calls[0][3]!:vi.mocked(service.update).mock.calls[0][3]!;
  await act(async()=>window.dispatchEvent(new Event("lw-account-changed")));
  expect(signal.aborted).toBe(true);
  await act(async()=>{targetResult.resolve({path:"/en-US/tasks/book"});readResult.resolve();});
  expect(host.querySelector('[data-path]')!.textContent).toBe("/en-US/notifications");
  if(phase==="target")expect(service.update).not.toHaveBeenCalled();
 });
}
it("keeps the form route when the unsaved-changes confirmation is cancelled",async()=>{
 const target=vi.spyOn(service,"target").mockResolvedValue({path:"/en-US/tasks/book"});await mount("en-US",false);
 document.body.dataset.unsavedChanges="true";
 try{
  await act(async()=>button("notifications.openProject").click());
  const cancel=document.querySelector<HTMLButtonElement>('.app-confirmation-actions button')!;expect(cancel).not.toBeNull();
  await act(async()=>cancel.click());expect(target).not.toHaveBeenCalled();
  expect(button("notifications.openProject").disabled).toBe(false);
  expect(host.querySelector('[data-path]')!.textContent).toBe("/en-US/notifications");
 }finally{delete document.body.dataset.unsavedChanges;}
});
