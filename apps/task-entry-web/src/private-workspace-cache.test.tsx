import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {describe,it,expect,vi} from "vitest";
import {SavedViews} from "@lifewood/ui/saved-views";
import {LoginSessions} from "@lifewood/ui/login-sessions";
import {personalWorkspaceService,loginDeviceService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe("private workspace cache",()=>{
 it.each(["views","devices"])("does not render account A's %s when account B opens the dialog",async kind=>{
  await i18n.changeLanguage("en-US");const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  const device={id:"a-device",browser:"chrome",platform:"windows",current:true,expiresAt:"2030-01-01T00:00:00Z"};
  client.setQueryData(["saved-views","a","tasks"],[{id:"a-view",name:"A private search",area:"tasks",filters:{q:"secret"},version:1}]);
  client.setQueryData(["login-devices","a",1],{items:[device],page:1,total:1});
  const views=vi.spyOn(personalWorkspaceService,"views").mockResolvedValue([{id:"b-view",name:"B filter",area:"tasks",filters:{},version:1}]);
  const devices=vi.spyOn(loginDeviceService,"list").mockResolvedValue({items:[{...device,id:"b-device",browser:"firefox"}],page:1,total:1});
  const show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  try{
   await act(async()=>root.render(<QueryClientProvider client={client}>{kind==="views"?<SavedViews userId="b" area="tasks" filters={{}} onApply={()=>{}}/>:<LoginSessions userId="b"/>}</QueryClientProvider>));
   await act(async()=>{container.querySelector<HTMLButtonElement>("button")!.click();await new Promise(r=>setTimeout(r,25));});
   await act(async()=>{await new Promise(r=>setTimeout(r,25));});
   const text=container.querySelector("dialog")!.textContent!;expect(text).not.toContain("A private search");expect(text).not.toContain("Chrome");expect(text).toContain(kind==="views"?"B filter":"Firefox");
   expect(kind==="views"?views:devices).toHaveBeenCalledTimes(1);
  }finally{await act(async()=>root.unmount());client.clear();container.remove();views.mockRestore();devices.mockRestore();if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;}
 });
});
