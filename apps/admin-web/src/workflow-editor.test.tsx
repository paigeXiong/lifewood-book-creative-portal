// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {expect,it,vi} from "vitest";
import {i18n} from "@lifewood/i18n";
import type {AdminProjectDetail} from "@lifewood/domain";
import {WorkflowEditor,workflowRouteDraft,workflowReturnPath,closeWorkflowDraft,type WorkflowDraft} from "./WorkflowEditor";
import "./i18n";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("does not resurrect completed drafts from older history entries",()=>{
 const draft:WorkflowDraft={flowId:crypto.randomUUID(),projectId:"project",projectSearch:"?q=book&page=2",workflowStatus:"new",priority:"normal",expectedUpdatedAt:"original-version"};
 expect(workflowRouteDraft({workflowEditor:draft},"other")).toBeUndefined();
 expect(workflowRouteDraft({workflowEditor:draft},"project")).toEqual(draft);
 expect(workflowReturnPath("en-US",draft)).toBe("/en-US/projects?q=book&page=2&project=project");
 closeWorkflowDraft(draft.flowId);expect(workflowRouteDraft({workflowEditor:draft},"project")).toBeUndefined();
});
it.each(["zh-CN","en-US"])("operators can change progress but cannot change the assignee in %s",async locale=>{
 await i18n.changeLanguage(locale);const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
 const save=vi.fn().mockResolvedValue(undefined),close=vi.fn();
 const detail={project:{id:"project"},workflowStatus:"new",priority:"normal",assigneeUserId:"assigned",assigneeName:"Operator",workflowUpdatedAt:"original-version"} as AdminProjectDetail;
 try{
  await act(async()=>root.render(<MemoryRouter><WorkflowEditor detail={detail} locale={locale as "zh-CN"|"en-US"} permissions={["admin.projects.workflow"]} workflowOptions={[{id:"new",label:"New"},{id:"contacting",label:"Contacting"}]} priorityOptions={[{id:"normal",label:"Normal"}]} busy={false} error={undefined} onSave={save} onClose={close}/></MemoryRouter>));
  expect(host.querySelector('select')).toBeNull();expect(host.querySelector('.workflow-assignee-actions')).toBeNull();
  await act(async()=>host.querySelector<HTMLInputElement>('input[value="contacting"]')!.click());
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({workflowStatus:"contacting",assigneeUserId:"assigned",expectedUpdatedAt:"original-version"}));expect(close).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());host.remove();}
});
