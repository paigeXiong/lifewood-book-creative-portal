// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter,useNavigate,useLocation} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {expect,it,vi} from "vitest";
import {adminService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import type {CurrentUser} from "@lifewood/domain";
import {ProjectsPage} from "./App";
import "./i18n";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it.each(["zh-CN","en-US"] as const)("restores saved-filter search, status, priority and page through history (%s)",async locale=>{
 await i18n.changeLanguage(locale);const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}});
 client.setQueryData(["form-options",locale],{workflowStatuses:[{id:"new",label:"New"},{id:"contacting",label:"Contacting"}],projectPriorities:[{id:"normal",label:"Normal"},{id:"high",label:"High"}]});
 client.setQueryDefaults(["form-options"],{staleTime:Infinity});
 client.setQueryData(["saved-views","owner","projects"],[{id:"b",name:"Saved B",area:"projects",version:1,filters:{q:"B",workflow:"contacting",priority:"high"}}]);client.setQueryDefaults(["saved-views"],{staleTime:Infinity});
 const list=vi.spyOn(adminService,"listProjects").mockImplementation(async args=>({items:[],page:args?.page??1,pageSize:20,total:60}));
 const show=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 function Test(){const navigate=useNavigate(),location=useLocation();return <><button data-back onClick={()=>navigate(-1)}>Back</button><button data-forward onClick={()=>navigate(1)}>Forward</button><output>{location.search}</output><ProjectsPage locale={locale} user={{id:"owner",permissions:[]} as unknown as CurrentUser}/></>;}
 const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,25));});};
 const click=async(selector:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());await settle();};
 const check=(q:string,workflow:string,priority:string,page:number)=>{expect(host.querySelector<HTMLInputElement>('input[name="q"]')!.value).toBe(q);const selects=host.querySelectorAll<HTMLSelectElement>('.page-toolbar>select');expect(selects[0].value).toBe(workflow);expect(selects[1].value).toBe(priority);expect(list).toHaveBeenLastCalledWith(expect.objectContaining({search:q,workflowStatus:workflow,priority,page}));};
 try{
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/projects?q=A&workflow=new&priority=normal&page=2`]}><Test/></MemoryRouter></QueryClientProvider>));await settle();check("A","new","normal",2);
  await click('.saved-views-trigger');await click('.saved-view-name');check("B","contacting","high",1);
  await click('[data-back]');check("A","new","normal",2);expect(host.querySelector('output')!.textContent).toContain('q=A');
  await click('[data-forward]');check("B","contacting","high",1);expect(host.querySelector('output')!.textContent).toContain('q=B');
 }finally{await act(async()=>root.unmount());host.remove();client.clear();list.mockRestore();if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;}
});
