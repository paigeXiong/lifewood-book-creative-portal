import {act, useState} from "react";
import {createRoot} from "react-dom/client";
import {createMemoryRouter, RouterProvider, useLocation} from "react-router-dom";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {AccountLocaleRedirect} from "@lifewood/ui/account-locale";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

beforeEach(async()=>{
 const {transferableAbortController}=await vi.importActual<{transferableAbortController:()=>AbortController}>("node:util");
 vi.stubGlobal("AbortController",class{constructor(){return transferableAbortController();}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("account language redirect",()=>{
 it.each(["zh-CN","en-US"])("preserves page, state, query, hash and history for %s",async locale=>{
  const other=locale==="zh-CN"?"en-US":"zh-CN";
  function Screen(){const location=useLocation();return <><AccountLocaleRedirect locale={locale}/><span>{location.pathname}</span></>;}
  const router=createMemoryRouter([{path:"/*",element:<Screen/>}],{basename:"/admin",initialEntries:["/admin/previous",{pathname:`/admin/${other}/projects`,search:"?project=p42&search=book",hash:"#files",state:{selected:"p42"}}],initialIndex:1});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
   await act(async()=>root.render(<RouterProvider router={router}/>));
   expect(router.state.location).toMatchObject({pathname:`/admin/${locale}/projects`,search:"?project=p42&search=book",hash:"#files",state:{selected:"p42"}});
   await act(async()=>{await router.navigate(-1);});expect(router.state.location.pathname).toBe("/admin/previous");
  }finally{await act(async()=>root.unmount());router.dispose();host.remove();}
 });
 it("does not unmount edited fields when a saved preference changes",async()=>{
  function Screen(){const [locale,setLocale]=useState("zh-CN");return <><AccountLocaleRedirect locale={locale}/><input defaultValue="original"/><button onClick={()=>setLocale("en-US")}>change</button></>;}
  const router=createMemoryRouter([{path:"/:locale/*",element:<Screen/>}],{initialEntries:["/zh-CN/profile"]});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
   await act(async()=>root.render(<RouterProvider router={router}/>));
   const input=host.querySelector("input")!;input.value="unsaved";
   await act(async()=>host.querySelector("button")!.click());
   expect(router.state.location.pathname).toBe("/en-US/profile");expect(host.querySelector("input")).toBe(input);expect(input.value).toBe("unsaved");
  }finally{await act(async()=>root.unmount());router.dispose();host.remove();}
 });
 it.each([null,undefined,"unsupported"])("keeps the route for an unset or invalid preference: %s",async locale=>{
  const router=createMemoryRouter([{path:"/*",element:<AccountLocaleRedirect locale={locale}/>}],{initialEntries:["/zh-CN/tasks"]});
  const host=document.createElement("div");const root=createRoot(host);
  try{await act(async()=>root.render(<RouterProvider router={router}/>));expect(router.state.location.pathname).toBe("/zh-CN/tasks");}
  finally{await act(async()=>root.unmount());router.dispose();}
 });
});
