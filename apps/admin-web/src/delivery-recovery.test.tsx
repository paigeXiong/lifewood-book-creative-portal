// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { adminService, ApiError } from "@lifewood/api-client";
import type { FinalDelivery } from "@lifewood/domain";
import { useDeliveryUpload } from "./useDeliveryUpload";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const delivery = { id:"delivery",projectId:"project",fileName:"final.mp4",contentType:"video/mp4",sizeBytes:5,publishedAt:"2026-09-12T00:00:00Z" } as FinalDelivery;
const file = () => new File(["video"],"final.mp4",{type:"video/mp4"});
it("keeps a quota-rejected delivery retryable without selecting the video again",async()=>{
 const post=vi.spyOn(adminService,"publishFinalDelivery").mockRejectedValueOnce(new ApiError({code:"storage.quota",messageKey:"errors.storage.quota",retryable:true})).mockResolvedValue(delivery);
 vi.spyOn(adminService,"getDeliveryUpload").mockResolvedValue({recorded:false});const f=await fixture();const original=file();
 try{await act(async()=>f.hook.run(original,"Ready"));expect(f.hook.outcome).toBe("retry");expect(f.hook.frozen).toBe(true);expect(post).toHaveBeenCalledOnce();await act(async()=>f.hook.run());expect(post.mock.calls[1].slice(0,3)).toEqual(["project",original,"Ready"]);expect(post.mock.calls[1][3]?.uploadId).toBe(post.mock.calls[0][3]?.uploadId);expect(f.complete).toHaveBeenCalledOnce();}finally{await f.dispose();}
});
afterEach(()=>vi.restoreAllMocks());
async function fixture() {
 let hook!:ReturnType<typeof useDeliveryUpload>; const complete=vi.fn(); const root=createRoot(document.createElement("div"));
 function Harness({id="project"}:{id?:string}) {hook=useDeliveryUpload(id,complete);return null;}
 await act(async()=>root.render(<Harness/>));
 return { get hook(){return hook;}, complete, render:async(id:string)=>{await act(async()=>root.render(<Harness id={id}/>));},dispose:async()=>{await act(async()=>root.unmount());}};
}
it("recognizes a committed delivery after a lost response without republishing",async()=>{
 const post=vi.spyOn(adminService,"publishFinalDelivery").mockRejectedValue(new TypeError("offline"));
 vi.spyOn(adminService,"getDeliveryUpload").mockResolvedValue({recorded:true,delivery});const f=await fixture();
 try{await act(async()=>f.hook.run(file(),"Ready"));expect(f.complete).toHaveBeenCalledWith(delivery);expect(post).toHaveBeenCalledOnce();expect(f.hook.frozen).toBe(false);}finally{await f.dispose();}
});
it("unknown results permit only a read and cannot discard the upload attempt",async()=>{
 const post=vi.spyOn(adminService,"publishFinalDelivery").mockRejectedValue(new TypeError("offline"));
 const get=vi.spyOn(adminService,"getDeliveryUpload").mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({recorded:false});const f=await fixture();
 try{await act(async()=>f.hook.run(file(),"Ready"));expect(f.hook.outcome).toBe("unknown");await act(async()=>f.hook.reset());expect(f.hook.frozen).toBe(true);await act(async()=>f.hook.run());expect(f.hook.outcome).toBe("retry");expect(post).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledTimes(2);}finally{await f.dispose();}
});
it("retries the same file, note and key after checking again",async()=>{
 const post=vi.spyOn(adminService,"publishFinalDelivery").mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(delivery);
 vi.spyOn(adminService,"getDeliveryUpload").mockResolvedValue({recorded:false});const f=await fixture();const original=file();
 try{await act(async()=>f.hook.run(original,"Ready"));await act(async()=>f.hook.run(file(),"Different"));expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1].slice(0,3)).toEqual(["project",original,"Ready"]);expect(post.mock.calls[1][3]?.uploadId).toBe(post.mock.calls[0][3]?.uploadId);expect(f.complete).toHaveBeenCalledOnce();}finally{await f.dispose();}
});
it("never republishes a delivery withdrawn after the first upload",async()=>{
 const post=vi.spyOn(adminService,"publishFinalDelivery").mockRejectedValue(new TypeError("offline"));
 vi.spyOn(adminService,"getDeliveryUpload").mockResolvedValue({recorded:true,delivery:{...delivery,revokedAt:"2026-09-12T01:00:00Z"}});const f=await fixture();
 try{await act(async()=>f.hook.run(file()));expect(f.hook.outcome).toBe("revoked");await act(async()=>f.hook.run());expect(post).toHaveBeenCalledOnce();expect(f.complete).not.toHaveBeenCalled();}finally{await f.dispose();}
});
it("checks the server after cancellation because publication may have committed",async()=>{
 vi.spyOn(adminService,"publishFinalDelivery").mockImplementation((_id,_file,_note,options)=>new Promise((_resolve,reject)=>options?.signal?.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")))));
 vi.spyOn(adminService,"getDeliveryUpload").mockResolvedValue({recorded:true,delivery});const f=await fixture();
 try{let pending!:Promise<void>;await act(async()=>{pending=f.hook.run(file());});await act(async()=>{f.hook.cancel();await pending;});expect(f.complete).toHaveBeenCalledWith(delivery);}finally{await f.dispose();}
});
it("ignores late results when switching projects and prevents duplicate clicks",async()=>{
 let finish!:(value:FinalDelivery)=>void;const post=vi.spyOn(adminService,"publishFinalDelivery").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const f=await fixture();
 try{let pending!:Promise<void>;await act(async()=>{pending=f.hook.run(file());void f.hook.run(file());});await f.render("other");await act(async()=>{finish(delivery);await pending;});expect(f.complete).not.toHaveBeenCalled();expect(f.hook.frozen).toBe(false);expect(f.hook.isPending).toBe(false);expect(post).toHaveBeenCalledOnce();}finally{await f.dispose();}
});
