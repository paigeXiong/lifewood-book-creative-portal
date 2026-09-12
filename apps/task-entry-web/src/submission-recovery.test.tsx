import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, projectService } from "@lifewood/api-client";
import type { TaskDraft, SupportedLocale } from "@lifewood/domain";
import { useProjectSubmission } from "./useProjectSubmission";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const draft = (id="task", version=7, status="draft") => ({id,version,status} as TaskDraft);
afterEach(()=>vi.restoreAllMocks());
async function fixture() {
  let current!:ReturnType<typeof useProjectSubmission>;
  const complete=vi.fn();const node=document.createElement("div");const root=createRoot(node);
  function Harness({id="task",locale="en-US"}:{id?:string;locale?:SupportedLocale}) {current=useProjectSubmission(id,locale,draft(id),complete);return null;}
  await act(async()=>root.render(<Harness/>));
  return {get hook(){return current;},complete,render:async(id:string,locale:SupportedLocale="en-US")=>{await act(async()=>root.render(<Harness id={id} locale={locale}/>));},dispose:async()=>{await act(async()=>root.unmount());}};
}
const validation=()=>vi.spyOn(projectService,"validateProject").mockResolvedValue({valid:true,fieldErrors:[]});
describe("submission recovery",()=>{
  it("recognizes a committed submission after a lost response without sending it again",async()=>{
    const validate=validation();const post=vi.spyOn(projectService,"submitProject").mockRejectedValue(new TypeError("network"));
    const get=vi.spyOn(projectService,"getProject").mockResolvedValue(draft("task",8,"submitted"));const f=await fixture();
    try {await act(async()=>f.hook.run());expect(f.complete).toHaveBeenCalledWith(draft("task",8,"submitted"));expect(post).toHaveBeenCalledOnce();expect(validate).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledOnce();expect(f.hook.isPending).toBe(false);}
    finally{await f.dispose();}
  });
  it("checks an unknown result without another validation or submission",async()=>{
    const validate=validation();const post=vi.spyOn(projectService,"submitProject").mockRejectedValue(new TypeError("network"));
    const get=vi.spyOn(projectService,"getProject").mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(draft("task",8,"submitted"));const f=await fixture();
    try {await act(async()=>f.hook.run());expect(f.hook.outcome).toBe("unknown");expect(f.complete).not.toHaveBeenCalled();await act(async()=>f.hook.run());expect(post).toHaveBeenCalledOnce();expect(validate).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledTimes(2);expect(f.complete).toHaveBeenCalledOnce();}
    finally{await f.dispose();}
  });
  it("reuses the same key and version when retrying an uncommitted request",async()=>{
    validation();const post=vi.spyOn(projectService,"submitProject").mockRejectedValueOnce(new TypeError("network")).mockResolvedValue(draft("task",8,"submitted"));
    vi.spyOn(projectService,"getProject").mockResolvedValue(draft());const f=await fixture();
    try {await act(async()=>f.hook.run());expect(f.hook.outcome).toBe("retry");await act(async()=>f.hook.run());expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);expect(f.complete).toHaveBeenCalledOnce();}
    finally{await f.dispose();}
  });
  it("does not resend after another editor changed the draft",async()=>{
    const validate=validation();const post=vi.spyOn(projectService,"submitProject").mockRejectedValue(new TypeError("network"));
    vi.spyOn(projectService,"getProject").mockResolvedValue(draft("task",9));const f=await fixture();
    try {await act(async()=>f.hook.run());expect(f.hook.outcome).toBe("changed");await act(async()=>f.hook.run());expect(post).toHaveBeenCalledOnce();expect(validate).toHaveBeenCalledOnce();expect(f.complete).not.toHaveBeenCalled();}
    finally{await f.dispose();}
  });
  it("checks a read-only validation result instead of treating an already submitted project as a failure",async()=>{
    vi.spyOn(projectService,"validateProject").mockRejectedValue(new ApiError({code:"project.not_editable",retryable:false}));const post=vi.spyOn(projectService,"submitProject");
    vi.spyOn(projectService,"getProject").mockResolvedValue(draft("task",8,"submitted"));const f=await fixture();
    try {await act(async()=>f.hook.run());expect(post).not.toHaveBeenCalled();expect(f.complete).toHaveBeenCalledOnce();}finally{await f.dispose();}
  });
  it("keeps validation errors and does not submit incomplete data",async()=>{
    const errors=[{field:"book.title",code:"required"}];vi.spyOn(projectService,"validateProject").mockResolvedValue({valid:false,fieldErrors:errors});const post=vi.spyOn(projectService,"submitProject");const f=await fixture();
    try {await act(async()=>f.hook.run());expect(f.hook.validationIssues).toEqual(errors);expect(post).not.toHaveBeenCalled();}finally{await f.dispose();}
  });
  it("deduplicates clicks while validating and stops before submitting after switching projects",async()=>{
    let resolve!:(value:{valid:boolean;fieldErrors:[]})=>void;
    const validate=vi.spyOn(projectService,"validateProject").mockImplementation(()=>new Promise(done=>{resolve=done;}));const post=vi.spyOn(projectService,"submitProject");const f=await fixture();
    try {let pending!:Promise<void>;await act(async()=>{pending=f.hook.run();void f.hook.run();});expect(validate).toHaveBeenCalledOnce();await f.render("other");await act(async()=>{resolve({valid:true,fieldErrors:[]});await pending;});expect(post).not.toHaveBeenCalled();expect(f.complete).not.toHaveBeenCalled();expect(f.hook.isPending).toBe(false);}
    finally{await f.dispose();}
  });
  it("ignores a late submission response after switching projects",async()=>{
    validation();let resolve!:(value:TaskDraft)=>void;vi.spyOn(projectService,"submitProject").mockImplementation(()=>new Promise(done=>{resolve=done;}));const f=await fixture();
    try {let pending!:Promise<void>;await act(async()=>{pending=f.hook.run();});await f.render("other");await act(async()=>{resolve(draft("task",8,"submitted"));await pending;});expect(f.complete).not.toHaveBeenCalled();expect(f.hook.isPending).toBe(false);}
    finally{await f.dispose();}
  });
  it.each(["project", "locale"])("ignores an old reload reset after switching %s",async(change)=>{
    const validate=validation();const post=vi.spyOn(projectService,"submitProject").mockRejectedValue(new TypeError("network"));
    const get=vi.spyOn(projectService,"getProject").mockRejectedValue(new TypeError("offline"));const f=await fixture();
    try {
      const oldReset=f.hook.reset;
      await f.render(change==="project"?"other":"task",change==="locale"?"zh-CN":"en-US");
      await act(async()=>f.hook.run());expect(f.hook.outcome).toBe("unknown");
      await act(async()=>oldReset());expect(f.hook.outcome).toBe("unknown");
      await act(async()=>f.hook.run());expect(post).toHaveBeenCalledOnce();expect(validate).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledTimes(2);
    }finally{await f.dispose();}
  });

});
