// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {adminService,ApiError} from "@lifewood/api-client";
import type {AdminFormOption} from "@lifewood/domain";
import {i18n} from "@lifewood/i18n";
import "./i18n";
import {FormOptionConfigPage} from "./FormOptionConfigPage";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
for(const locale of ["zh-CN","en-US"] as const)it(`filters, toggles and safely removes options (${locale})`,async()=>{
 await i18n.changeLanguage(locale);
 let data:AdminFormOption[]=[{groupId:"video-goals",id:"unused",labelZhCn:"未使用",labelEnUs:"Unused",enabled:true,sortOrder:0,updatedAt:"v1"},{groupId:"video-goals",id:"disabled",labelZhCn:"已停用测试",labelEnUs:"Disabled sample",enabled:false,sortOrder:1,updatedAt:"v1"}];
 vi.spyOn(adminService,"listFormOptionGroups").mockResolvedValue([{id:"project",label:"Project",groups:[{id:"video-goals",label:"Goals"}]}]);
 vi.spyOn(adminService,"listFormOptions").mockImplementation(async()=>[...data]);
 const save=vi.spyOn(adminService,"saveFormOption").mockImplementation(async value=>{data=data.map(x=>x.id===value.id?{...value,updatedAt:"v2"}:x);return data.find(x=>x.id===value.id)!;});
 const remove=vi.spyOn(adminService,"removeFormOption").mockRejectedValueOnce(new ApiError({code:"config.referenced",messageKey:"admin.formOptions.removeReferenced",retryable:false})).mockImplementation(async option=>{data=data.filter(x=>x.id!==option.id);});
 const show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal"),close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(){this.open=false;}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 const button=(label:string)=>[...c.querySelectorAll<HTMLButtonElement>("tbody button")].find(x=>x.textContent===i18n.t(label))!;
 const confirm=async(accept:boolean)=>{await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(x=>x.textContent===i18n.t(accept?"common.confirmAction":"common.cancel"))!.click();await settle();});};
 try{
  await act(async()=>{root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/?group=video-goals"]}><FormOptionConfigPage locale={locale}/></MemoryRouter></QueryClientProvider>);await settle();});await act(async()=>{await settle();});
  for(let i=0;i<10 && !c.querySelector("tbody tr");i++)await act(async()=>{await settle();});
  expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
  await act(async()=>button("admin.formOptions.stop").click());await confirm(true);expect(save).toHaveBeenCalledTimes(1);expect(c.querySelectorAll("tbody tr")).toHaveLength(0);
  const filter=c.querySelector<HTMLSelectElement>(".option-status-filter")!;
  await act(async()=>{filter.value="disabled";filter.dispatchEvent(new Event("change",{bubbles:true}));});expect(c.querySelectorAll("tbody tr")).toHaveLength(2);
  await act(async()=>{button("admin.formOptions.start").click();await settle();});expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
  await act(async()=>button("admin.formOptions.remove").click());await confirm(false);expect(remove).not.toHaveBeenCalled();
  await act(async()=>button("admin.formOptions.remove").click());await confirm(true);expect(c.textContent).toContain(i18n.t("admin.formOptions.removeReferenced"));expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
  await act(async()=>button("admin.formOptions.remove").click());await confirm(true);expect(c.querySelectorAll("tbody tr")).toHaveLength(0);
 }finally{await act(async()=>root.unmount());c.remove();client.clear();vi.restoreAllMocks();if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");if(close)Object.defineProperty(HTMLDialogElement.prototype,"close",close);else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");}
});
