import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {ApiError,feedbackService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import {FeedbackButton} from "./components/FeedbackButton";
import {prepareFeedbackScreenshot} from "./prepare-feedback-screenshot";
vi.mock("./prepare-feedback-screenshot",()=>({prepareFeedbackScreenshot:vi.fn(async(file:File)=>file),FeedbackImageError:class extends Error{}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal"),close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});});
afterEach(()=>{vi.restoreAllMocks();if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");if(close)Object.defineProperty(HTMLDialogElement.prototype,"close",close);else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");});
for(const locale of ["zh-CN","en-US"] as const){
 it(`preserves feedback on timeout and retries the same payload (${locale})`,async()=>{
  await i18n.changeLanguage(locale);const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});client.setQueryData(["current-user"],{id:"account"});client.setQueryData(["feedback-catalog",locale],{categories:[{id:"bug",label:"Bug"}],statuses:[],screenshotMaxBytes:1000000,screenshotSourceMaxBytes:10000000});
  const send=vi.spyOn(feedbackService,"submit").mockRejectedValueOnce(new ApiError({code:"feedback.timeout",messageKey:"feedback.timeout",retryable:true})).mockResolvedValue(undefined);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
   await act(async()=>root.render(<QueryClientProvider client={client}><FeedbackButton userId="account" locale={locale}/></QueryClientProvider>));await act(async()=>host.querySelector<HTMLButtonElement>(".feedback-trigger")!.click());
   const field=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"My unsent feedback");field.dispatchEvent(new Event("input",{bubbles:true}));});
   await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
   expect(host.textContent).toContain(i18n.t("feedback.timeout"));expect(field.value).toBe("My unsent feedback");expect(host.querySelector<HTMLButtonElement>('footer button[type="button"]')!.disabled).toBe(false);
   const first=send.mock.calls[0][0];await act(async()=>host.querySelector<HTMLButtonElement>('footer button[type="button"]')!.click());await act(async()=>host.querySelector<HTMLButtonElement>(".feedback-trigger")!.click());
   await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
   expect(send.mock.calls[1][0]).toEqual(first);expect(host.textContent).toContain(i18n.t("feedback.submitted"));
  }finally{await act(async()=>root.unmount());host.remove();client.clear();}
 });
 it(`resets the file input and retains the prior screenshot if replacement fails (${locale})`,async()=>{
  await i18n.changeLanguage(locale);const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});client.setQueryData(["current-user"],{id:"account"});client.setQueryData(["feedback-catalog",locale],{categories:[{id:"bug",label:"Bug"}],statuses:[]});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const prepare=vi.mocked(prepareFeedbackScreenshot);prepare.mockClear();prepare.mockResolvedValue(new File(["image"],"screen.png",{type:"image/png"}));
  try{
   await act(async()=>root.render(<QueryClientProvider client={client}><FeedbackButton userId="account" locale={locale}/></QueryClientProvider>));await act(async()=>host.querySelector<HTMLButtonElement>(".feedback-trigger")!.click());const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;
   let selected="";Object.defineProperty(input,"value",{configurable:true,get:()=>selected,set:value=>{selected=value;}});
   const choose=async()=>{selected="screen.png";Object.defineProperty(input,"files",{configurable:true,value:[new File(["image"],"screen.png",{type:"image/png"})]});await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
   await choose();expect(input.value).toBe("");expect(host.querySelector(".feedback-image-preview img")).not.toBeNull();
   prepare.mockRejectedValueOnce(new Error("decode"));await choose();expect(host.querySelector(".feedback-image-preview img")).not.toBeNull();
   await act(async()=>host.querySelector<HTMLButtonElement>(".feedback-image-preview button")!.click());expect(host.querySelector(".feedback-image-preview")).toBeNull();await choose();expect(prepare).toHaveBeenCalledTimes(3);expect(host.querySelector(".feedback-image-preview img")).not.toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();client.clear();}
 });
}
