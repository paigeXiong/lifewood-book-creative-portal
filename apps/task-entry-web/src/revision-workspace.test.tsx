import { act, useState } from "react";
import { i18n } from "@lifewood/i18n";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError, revisionService, type RevisionView } from "@lifewood/api-client";
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
 return <div id="form"><button id="home" onClick={()=>void navigate("/zh-CN/tasks")}>Home</button><button id="back-to-round" onClick={()=>void navigate("/zh-CN/tasks/task/edit/style")}>Back</button><input aria-label="Draft" value={draft} readOnly/><button id="edit" onClick={()=>setDraft("Unsaved text")}>Edit</button><output>{location.pathname}</output><StepProgress current={1} highestReachable={6} canContinue onNext={()=>void navigate("/zh-CN/tasks/task/edit/characters")}/><button id="continue" onClick={()=>void navigate("/zh-CN/tasks/task/edit/characters")}>Continue</button></div>;
}
async function render(view:RevisionView|undefined,step:string,check:(container:HTMLDivElement,client:QueryClient)=>Promise<void>,locale="zh-CN") {
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 if(view)client.setQueryData(["revision","task",locale],view);
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 try { await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/task/edit/${step}`]}><Routes><Route path="/:locale" element={<RevisionWorkspace><Outlet/></RevisionWorkspace>}><Route path="tasks/:taskId/edit/:step" element={<Form/>}/><Route path="tasks/:taskId" element={<div data-read-only/>}/><Route path="tasks" element={<Form/>}/></Route></Routes></MemoryRouter></QueryClientProvider>));await check(container,client);}
 finally {await act(async()=>root.unmount());client.clear();container.remove();}
}
describe("revision workspace",()=>{
 it.each(["zh-CN","en-US"])("redirects shared editors to readable feedback without write controls in %s",async locale=>{
  await render({...data(),canEdit:false},"style",async c=>{
   expect(c.querySelector("#form")).toBeNull();
   expect(c.querySelector("[data-read-only]")).not.toBeNull();
   expect(c.querySelector(".revision-pinned-reason")?.textContent).toContain("Clarify");
   expect(c.querySelector(".revision-chat form, .revision-unit-picker a")).toBeNull();
  },locale);
 });
 it("unmounts editing when previously cached permission is revoked",async()=>{
  const get=vi.spyOn(revisionService,"get").mockRejectedValue(new ApiError({code:"project.not_found",retryable:false}));
  try { await render({...data(),rounds:[]},"project",async(c,client)=>{
   expect(c.querySelector("#form")).not.toBeNull();
   await act(async()=>{await client.refetchQueries({queryKey:["revision","task","zh-CN"]}); await new Promise(resolve=>setTimeout(resolve,25));});
   expect(c.querySelector("#form")).toBeNull();
  }); } finally {get.mockRestore();}
 });
 it.each(["zh-CN","en-US"])("preserves mounted edits through refetch failure and recovery in %s",async locale=>{
  const view={...data(),rounds:[]};
  const get=vi.spyOn(revisionService,"get").mockRejectedValue(new ApiError({code:"network.unavailable",retryable:true}));
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
  const get=vi.spyOn(revisionService,"get").mockRejectedValue(new ApiError({code:"network.unavailable",retryable:true}));
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

function typeReply(container: HTMLDivElement, value: string) {
 const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
 input.dispatchEvent(new Event("input", { bubbles: true }));
}
function submitReply(container: HTMLDivElement) {
 container.querySelector(".revision-chat form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function flushReply() { await new Promise(resolve => setTimeout(resolve, 0)); }

describe("revision reply delivery", () => {
 it.each(["zh-CN", "en-US"])("locks the submitted draft and unit until the reply settles in %s", async locale => {
  await i18n.changeLanguage(locale);
  const view = data();
  view.units.push({ id: "project", label: "Book" });
  view.rounds[0].reasons.push({ unit: "project", body: "Clarify book" });
  let finish!: (view: RevisionView) => void;
  const reply = vi.spyOn(revisionService, "reply").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const get = vi.spyOn(revisionService, "get").mockResolvedValue(view);
  try {
   await render(view, "style", async c => {
    await act(async () => typeReply(c, "Keep this approach"));
    await act(async () => { submitReply(c); submitReply(c); await flushReply(); });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][2]).toMatchObject({ unit: "style", body: "Keep this approach" });
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    expect(c.querySelector<HTMLSelectElement>(".revision-unit-picker select")!.disabled).toBe(true);
    expect(c.querySelector(".revision-chat form button")!.textContent).toBe(locale === "zh-CN" ? "正在发送…" : "Sending…");
    await act(async () => { finish(view); await flushReply(); await flushReply(); });
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
    expect(get).toHaveBeenCalledWith("task", locale);
   }, locale);
  } finally { reply.mockRestore(); get.mockRestore(); }
 });

 it("keeps failed text and reuses the message ID for an unchanged retry", async () => {
  const view = data();
  const reply = vi.spyOn(revisionService, "reply").mockRejectedValue(new Error("Connection lost after send"));
  const get = vi.spyOn(revisionService, "get").mockResolvedValue(view);
  try {
   await render(view, "style", async c => {
    await act(async () => typeReply(c, "Please keep it"));
    await act(async () => { submitReply(c); await flushReply(); await flushReply(); });
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Please keep it");
    expect(c.querySelector(".revision-chat [role=alert]")).not.toBeNull();
    await act(async () => { submitReply(c); await flushReply(); await flushReply(); });
    expect(reply.mock.calls[1][2].id).toBe(reply.mock.calls[0][2].id);
    await act(async () => typeReply(c, "Updated explanation"));
    reply.mockResolvedValue(view);
    await act(async () => { submitReply(c); await flushReply(); await flushReply(); });
    expect(reply.mock.calls[2][2].id).not.toBe(reply.mock.calls[0][2].id);
    expect(reply.mock.calls[2][2].body).toBe("Updated explanation");
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
   });
  } finally { reply.mockRestore(); get.mockRestore(); }
 });

 it("does not erase a new round's draft or replace its cache when an old reply arrives", async () => {
  const oldView = data();
  const newView = data();
  newView.rounds[0].id = "new-round";
  newView.rounds[0].reasons[0].body = "New reason";
  let finish!: (view: RevisionView) => void;
  const reply = vi.spyOn(revisionService, "reply").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const get = vi.spyOn(revisionService, "get").mockResolvedValue(newView);
  try {
   await render(oldView, "style", async (c, client) => {
    await act(async () => typeReply(c, "Old reply"));
    await act(async () => { submitReply(c); await flushReply(); });
    await act(async () => { client.setQueryData(["revision", "task", "zh-CN"], newView); await flushReply(); });
    await act(async () => typeReply(c, "New draft"));
    await act(async () => { finish(oldView); await flushReply(); await flushReply(); });
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("New draft");
    expect(c.querySelector(".revision-pinned-reason")!.textContent).toContain("New reason");
    expect(client.getQueryData<RevisionView>(["revision", "task", "zh-CN"])!.rounds[0].id).toBe("new-round");
   });
  } finally { reply.mockRestore(); get.mockRestore(); }
 });
 it("preserves a new draft after leaving and returning to the same round during send", async () => {
  const view = data();
  let finish!: (view: RevisionView) => void;
  const reply = vi.spyOn(revisionService, "reply").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const get = vi.spyOn(revisionService, "get").mockResolvedValue(view);
  try {
   await render(view, "style", async c => {
    await act(async () => typeReply(c, "Old reply"));
    await act(async () => { submitReply(c); await flushReply(); });
    await act(async () => c.querySelector<HTMLButtonElement>("#home")!.click());
    expect(c.querySelector(".revision-chat")).toBeNull();
    await act(async () => c.querySelector<HTMLButtonElement>("#back-to-round")!.click());
    await act(async () => typeReply(c, "New reply after returning"));
    await act(async () => { finish(view); await flushReply(); await flushReply(); });
    expect(c.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("New reply after returning");
   });
  } finally { reply.mockRestore(); get.mockRestore(); }
 });

});
