// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useUnsavedClose } from "./useUnsavedClose";
const {confirm}=vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock("./useConfirm",()=>({useConfirm:()=>confirm}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>confirm.mockReset());
async function fixture() {
 let hook!:ReturnType<typeof useUnsavedClose>,setBusy!:(value:boolean)=>void;const close=vi.fn();
 function Editor(){const [busy,update]=useState(false);setBusy=update;hook=useUnsavedClose(close,"Unsaved",busy);return null;}
 const router=createMemoryRouter([{path:"/",element:<Editor/>}]);const root=createRoot(document.createElement("div"));
 const render=async()=>{await act(async()=>root.render(<RouterProvider router={router}/>));};await render();
 return {get hook(){return hook;},close,setBusy:async(value:boolean)=>{await act(async()=>setBusy(value));},dispose:async()=>{await act(async()=>root.unmount());router.dispose();}};
}
it("does not lose a same-tick edit or ask twice for repeated close actions",async()=>{
 let answer!:(value:boolean)=>void;confirm.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));const f=await fixture();
 try{let pending!:Promise<void>;await act(async()=>{f.hook.markDirty();pending=f.hook.requestClose();void f.hook.requestClose();});expect(confirm).toHaveBeenCalledOnce();expect(f.close).not.toHaveBeenCalled();await act(async()=>{answer(false);await pending;});expect(f.close).not.toHaveBeenCalled();}finally{await f.dispose();}
});
it("ignores a confirmation completed after the editor unmounts",async()=>{
 let answer!:(value:boolean)=>void;confirm.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));const f=await fixture();let pending!:Promise<void>;
 await act(async()=>{f.hook.markDirty();pending=f.hook.requestClose();});await f.dispose();await act(async()=>{answer(true);await pending;});expect(f.close).not.toHaveBeenCalled();
});
it("keeps edits after a failed confirmation and allows a later close",async()=>{
 confirm.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(true);const f=await fixture();
 try{await act(async()=>{f.hook.markDirty();await f.hook.requestClose();});expect(f.close).not.toHaveBeenCalled();await act(async()=>f.hook.requestClose());expect(f.close).toHaveBeenCalledOnce();}finally{await f.dispose();}
});
it("does not close when saving starts while confirmation is open",async()=>{
 let answer!:(value:boolean)=>void;confirm.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));const f=await fixture();
 try{let pending!:Promise<void>;await act(async()=>{f.hook.markDirty();pending=f.hook.requestClose();});await f.setBusy(true);await act(async()=>{answer(true);await pending;});expect(f.close).not.toHaveBeenCalled();await act(async()=>f.hook.requestClose());expect(confirm).toHaveBeenCalledOnce();const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);}finally{await f.dispose();}
});
