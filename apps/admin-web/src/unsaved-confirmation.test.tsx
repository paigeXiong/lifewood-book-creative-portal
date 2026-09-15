// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { useUnsavedClose } from "./useUnsavedClose";
import { ModalFrame } from "./ModalFrame";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let show: PropertyDescriptor | undefined, close: PropertyDescriptor | undefined;
beforeEach(async () => {
  const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util");
  vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } });
  show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal"); close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(() => {
  vi.unstubAllGlobals();
  if(show) Object.defineProperty(HTMLDialogElement.prototype,"showModal",show); else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");
  if(close) Object.defineProperty(HTMLDialogElement.prototype,"close",close); else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");
});
for(const locale of ["zh-CN","en-US"] as const) {
  it.each(["close","route","escape","backdrop"] as const)(`preserves the admin editor on cancel and confirms %s (${locale})`, async mode => {
    await i18n.changeLanguage(locale);
    const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
    function Editor({onClose}:{onClose:()=>void}) {
      const {markDirty,requestClose}=useUnsavedClose(onClose,i18n.t("common.unsavedConfirm"));
      return <ModalFrame labelledBy="editor-title" onClose={requestClose}><h2 id="editor-title">Editor</h2><input defaultValue="unsaved" onInput={markDirty}/><button data-close onClick={requestClose}>Close</button></ModalFrame>;
    }
    function Page(){const [open,setOpen]=useState(true);return open?<Editor onClose={()=>setOpen(false)}/>:<p>Closed</p>;}
    const router=createMemoryRouter([{path:"/home",element:<p>Home</p>},{path:"/edit",element:<Page/>}],{initialEntries:["/home","/edit"]});
    const start=async()=>{await act(async()=>{if(mode==="close")c.querySelector<HTMLButtonElement>("[data-close]")!.click();else if(mode==="escape")document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));else if(mode==="backdrop")c.querySelector(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));else await router.navigate(-1);});};
    try {
      await act(async()=>root.render(<RouterProvider router={router}/>));
      await act(async()=>c.querySelector("input")!.dispatchEvent(new Event("input",{bubbles:true})));
      await start();
      expect(document.querySelector(".app-confirmation h2")?.textContent).toBe(i18n.t("common.confirmTitle"));
      await act(async()=>document.querySelector<HTMLButtonElement>(".app-confirmation-actions button:first-child")!.click());
      expect(router.state.location.pathname).toBe("/edit");expect(c.querySelector("input")?.value).toBe("unsaved");
      await start();
      await act(async()=>document.querySelector<HTMLButtonElement>(".app-confirmation-actions button:last-child")!.click());
      expect(c.querySelector("input")).toBeNull();
      expect(c.textContent).toContain(mode==="route"?"Home":"Closed");
    }finally{await act(async()=>root.unmount());router.dispose();c.remove();}
  });
}

for(const busy of [false,true]) {
 it(`allows language-only navigation while keeping an edited form (busy=${busy})`,async()=>{
  function Editor(){const {markDirty}=useUnsavedClose(()=>{},"Unsaved",busy);return <input defaultValue="original" onInput={markDirty}/>;}
  const router=createMemoryRouter([{path:"/:locale/*",element:<Editor/>}],{initialEntries:["/zh-CN/organizations?search=team#editor"]});
  const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
  try{
   await act(async()=>root.render(<RouterProvider router={router}/>));
   const input=c.querySelector("input")!;input.value="unsaved";
   await act(async()=>input.dispatchEvent(new Event("input",{bubbles:true})));
   await act(async()=>{await router.navigate("/en-US/organizations?search=team#editor",{replace:true});});
   expect(router.state.location.pathname).toBe("/en-US/organizations");
   expect(c.querySelector("input")).toBe(input);expect(input.value).toBe("unsaved");
   expect(document.querySelector(".app-confirmation")).toBeNull();
  }finally{await act(async()=>root.unmount());router.dispose();c.remove();}
 });
}

it("keeps a pending route confirmation effective when navigation is requested again",async()=>{
 function Editor(){const {markDirty}=useUnsavedClose(()=>{},"Unsaved");return <input onInput={markDirty}/>;}
 const router=createMemoryRouter([{path:"/edit",element:<Editor/>},{path:"/first",element:<p>First</p>},{path:"/second",element:<p>Second</p>}],{initialEntries:["/edit"]});
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try {
  await act(async()=>root.render(<RouterProvider router={router}/>));
  await act(async()=>c.querySelector("input")!.dispatchEvent(new Event("input",{bubbles:true})));
  await act(async()=>{await router.navigate("/first");});
  expect(document.querySelectorAll(".app-confirmation")).toHaveLength(1);
  await act(async()=>{await router.navigate("/second");});
  expect(document.querySelectorAll(".app-confirmation")).toHaveLength(1);
  await act(async()=>document.querySelector<HTMLButtonElement>(".app-confirmation-actions button:last-child")!.click());
  expect(router.state.location.pathname).toBe("/second");
 } finally {await act(async()=>root.unmount());router.dispose();c.remove();}
});
