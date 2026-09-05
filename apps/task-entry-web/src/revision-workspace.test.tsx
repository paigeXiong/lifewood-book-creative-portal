import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { revisionService, type RevisionView } from "@lifewood/api-client";
import { useWizardNavigate } from "./wizard-motion";
import { StepProgress } from "./components/StepProgress";
import { RevisionNavigation, RevisionLink, ReviewSection } from "./revision-navigation";
import { RevisionWorkspace } from "./components/RevisionWorkspace";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const labels={title:"退回沟通",locked:"本轮未退回此单元",review:"审阅并重新提交",pending:"待修改或回复",submitted:"已重新提交",close:"关闭",reply:"回复",send:"发送"};
function data(active=true): RevisionView {
 return {units:[{id:"style",label:"视觉风格"}],labels,hasMore:false,rounds:[{id:"r",createdAt:"2026-09-04T00:00:00Z",submittedAt:active?undefined:"2026-09-04T01:00:00Z",reasons:[{unit:"style",body:"Clarify"}],messages:[{id:"m",unit:"style",body:"Clarify",authorId:"admin",authorName:"Administrator",avatarUrl:"/avatar",isAdmin:true,createdAt:"2026-09-04T00:00:00Z"}]}]};
}
function Form() {
 const [draft,setDraft]=useState("");
 const location=useLocation();const navigate=useWizardNavigate();
 return <div id="form"><input aria-label="Draft" value={draft} readOnly/><button id="edit" onClick={()=>setDraft("Unsaved text")}>Edit</button><output>{location.pathname}</output><StepProgress current={1} highestReachable={6} canContinue onNext={()=>void navigate("/zh-CN/tasks/task/edit/characters")}/><button id="continue" onClick={()=>void navigate("/zh-CN/tasks/task/edit/characters")}>Continue</button></div>;
}
async function render(view:RevisionView|undefined,step:string,check:(container:HTMLDivElement,client:QueryClient)=>Promise<void>,locale="zh-CN") {
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 if(view)client.setQueryData(["revision","task",locale],view);
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 try { await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/task/edit/${step}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/:step" element={<RevisionWorkspace><Form/></RevisionWorkspace>}/></Routes></MemoryRouter></QueryClientProvider>));await check(container,client);}
 finally {await act(async()=>root.unmount());client.clear();container.remove();}
}
describe("revision workspace",()=>{
 it.each(["zh-CN","en-US"])("preserves mounted edits through refetch failure and recovery in %s",async locale=>{
  const view={...data(),rounds:[]};
  const get=vi.spyOn(revisionService,"get").mockRejectedValue(new Error("Offline"));
  try {
   await render(view,"project",async(c,client)=>{
    await act(async()=>c.querySelector<HTMLButtonElement>("#edit")!.click());
    const input=c.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
    await act(async()=>{await client.refetchQueries({queryKey:["revision","task",locale]});await new Promise(r=>setTimeout(r,0));});
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(c.querySelector('input[aria-label="Draft"]')).toBe(input);
    expect(input.value).toBe("Unsaved text");
    get.mockResolvedValue(view);
    await act(async()=>{await client.refetchQueries({queryKey:["revision","task",locale]});await new Promise(r=>setTimeout(r,0));});
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelector('input[aria-label="Draft"]')).toBe(input);
    expect(input.value).toBe("Unsaved text");
   },locale);
  }finally{get.mockRestore();}
 });
 it("does not mount an autosaving form when the initial permission request fails",async()=>{
  const get=vi.spyOn(revisionService,"get").mockRejectedValue(new Error("Offline"));
  try{await render(undefined,"project",async c=>{
   await act(async()=>{await new Promise(r=>setTimeout(r,10));});
   expect(c.querySelector('[role="alert"]')).not.toBeNull();
   expect(c.querySelector("#form")).toBeNull();
  });}finally{get.mockRestore();}
 });

 it("does not show chat for a project without messages",async()=>{await render({...data(),rounds:[]},"project",async c=>{expect(c.querySelector("#form")).not.toBeNull();expect(c.querySelector(".revision-float")).toBeNull();});});
 it("does not mount autosaving forms for locked units",async()=>{await render(data(),"characters",async c=>{expect(c.querySelector("output")?.textContent).toContain("/edit/style");expect(c.textContent).not.toContain(labels.locked);expect(c.querySelector('a[href$="/review"]')).not.toBeNull();});});
 it("allows returned units and review, showing author and avatar automatically",async()=>{for(const step of ["style","review"])await render(data(),step,async c=>{expect(c.querySelector("#form")).not.toBeNull();expect(c.textContent).toContain("Administrator");expect(c.querySelector("img")?.getAttribute("src")).toBe("/avatar");expect(c.querySelector("textarea")).not.toBeNull();});});
 it("disables unrequested steps and skips them on continue",async()=>{
 const view=data();view.rounds[0].reasons.unshift({unit:"project",body:"Book"});
 await render(view,"project",async c=>{
 expect(c.querySelector(".step-item:nth-child(2) a")).toBeNull();
 expect(c.querySelector(".step-item:nth-child(2) button")).toBeNull();
 await act(async()=>c.querySelector<HTMLButtonElement>("#continue")!.click());
 expect(c.querySelector("output")?.textContent).toContain("/edit/style");
 });
 });
 it("opens steps without navigating and keeps form edits when closing feedback",async()=>{
  await render(data(),"style",async c=>{
   await act(async()=>c.querySelector<HTMLButtonElement>("#edit")!.click());
   const input=c.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
   const expand=c.querySelector<HTMLButtonElement>(".step-compact button")!;
   await act(async()=>expand.click());
   expect(expand.getAttribute("aria-expanded")).toBe("true");
   expect(c.querySelector(".step-progress")!.classList.contains("steps-expanded")).toBe(true);
   await act(async()=>c.querySelector<HTMLButtonElement>(".revision-chat header button")!.click());
   expect(c.querySelector('input[aria-label="Draft"]')).toBe(input);
   expect(input.value).toBe("Unsaved text");
   expect(c.querySelector(".revision-chat")).toBeNull();
  });
 });
 it("shows one pinned reason without a redundant selector for a single unit",async()=>{
  await render(data(),"style",async c=>{
   expect(c.querySelector(".revision-pinned-reason")!.textContent).toContain("Clarify");
   expect(c.querySelector(".revision-unit-picker select")).toBeNull();
  });
 });
 it("hides locked review edit links and collapses unrelated sections",async()=>{
  const container=document.createElement("div");const root=createRoot(container);
  try {
   await act(async()=>root.render(<MemoryRouter><RevisionNavigation.Provider value={["style","review"]}>
     <ReviewSection units={["project"]}><h2>Book</h2><RevisionLink hideWhenLocked to="/zh-CN/tasks/t/edit/project">Edit book</RevisionLink></ReviewSection>
     <ReviewSection units={["style"]}><h2>Style</h2><RevisionLink hideWhenLocked to="/zh-CN/tasks/t/edit/style">Edit style</RevisionLink></ReviewSection>
   </RevisionNavigation.Provider></MemoryRouter>));
   expect(container.querySelectorAll("a")).toHaveLength(1);
   expect(container.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
   expect(container.querySelectorAll<HTMLDetailsElement>("details")[1].open).toBe(true);
  }finally{await act(async()=>root.unmount());}
 });
 it("closed rounds are read only",async()=>{await render(data(false),"style",async c=>{await act(async()=>c.querySelector<HTMLButtonElement>(".revision-toggle")!.click());expect(c.querySelector("textarea")).toBeNull();expect(c.textContent).toContain(labels.submitted);});});
});
