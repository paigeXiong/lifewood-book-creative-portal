import {act,type PropsWithChildren} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter,Routes,Route} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,expect,it,vi} from "vitest";
import {ApiError,authService,projectService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import {ProtectedLayout} from "./App";
import {ProfilePage} from "./pages/ProfilePage";
import {TaskDetailPage} from "./pages/TaskDetailPage";
import {canRetainQueryData} from "./components/RefreshNotice";
vi.mock("./components/AppShell",()=>({AppShell:({children}:PropsWithChildren)=><div data-shell>{children}</div>}));
vi.mock("./components/FinalDeliverySection",()=>({FinalDeliverySection:()=> <div data-delivery/>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>vi.restoreAllMocks());
const temporary=()=>new ApiError({code:"network.unavailable",messageKey:"errors.network.unavailable",retryable:true});
const rejected=()=>new ApiError({code:"auth.forbidden",messageKey:"errors.auth.forbidden",retryable:false});
const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
const catalog={brands:[],videoGoals:[],audiences:[],genres:[],contentLanguages:[],videoDurations:[],publishingPlatforms:[],taskStatuses:[],roleTypes:[],ageRanges:[],genders:[],visualStyles:[],moodTags:[],imageStyleTags:[],paceTags:[],narrationTones:[],speechRates:[],voiceGenders:[],voiceAges:[],accents:[],voiceEmotions:[],voiceTags:[],sourceCategories:[],referenceCategories:[],maxSelectedVoices:3,workflowStatuses:[],projectPriorities:[]};
const task={id:"task",status:"submitted",version:1,createdAt:"2026-09-14T00:00:00Z",updatedAt:"2026-09-14T00:00:00Z",project:{clientName:"Client",contactName:"Contact",email:"contact@example.com",projectName:"My project",videoGoalId:"",audienceIds:[]},book:{title:"My book",authorName:"Author",genreId:"",sellingPoint:"",synopsis:"",publishingPlatformIds:[],sourceAssets:[]},creative:{characters:[],moodTagIds:[],imageStyleTagIds:[],paceTagIds:[],styleReferenceImageUrls:[],styleReferenceImages:[]},voiceAndReferences:{voiceover:{narrationEnabled:false,selectedVoiceIds:[]},assets:[],competitorUrls:[],creativeDirection:{}}};
for(const locale of ["zh-CN","en-US"] as const){
 it(`keeps profile edits and leave protection through an account refresh failure (${locale})`,async()=>{
  await i18n.changeLanguage(locale);const user={id:"customer",displayName:"Customer",email:"user@example.com",phone:"123",locale,roles:["customer"],permissions:[]};const get=vi.spyOn(authService,"getCurrentUser").mockRejectedValue(temporary());
  const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});client.setQueryData(["current-user"],user);const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
   await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/profile`]}><Routes><Route path="/:locale" element={<ProtectedLayout/>}><Route path="profile" element={<ProfilePage/>}/></Route><Route path="/:locale/login" element={<div data-login/>}/></Routes></MemoryRouter></QueryClientProvider>));
   await act(async()=>host.querySelector<HTMLButtonElement>(".profile-edit-button")!.click());const field=host.querySelector<HTMLInputElement>("#profile-display-name")!;
   await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,"Unfinished name");field.dispatchEvent(new Event("input",{bubbles:true}));});
   await act(async()=>client.refetchQueries({queryKey:["current-user"]}));await settle();
   expect(host.querySelector("#profile-display-name")).toBe(field);expect(field.value).toBe("Unfinished name");expect(document.body.dataset.unsavedChanges).toBe("true");expect(host.textContent).toContain(i18n.t("recovery.refreshFailed"));
   get.mockResolvedValue(user);await act(async()=>host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());await settle();expect(field.value).toBe("Unfinished name");expect(host.textContent).not.toContain(i18n.t("recovery.refreshFailed"));
   get.mockRejectedValue(new ApiError({code:"auth.unauthorized",retryable:false}));await act(async()=>client.refetchQueries({queryKey:["current-user"]}));await settle();expect(host.querySelector("[data-login]")).not.toBeNull();expect(host.querySelector("#profile-display-name")).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();client.clear();}
 });
 it(`retains project details after a failed refresh but removes them after access is denied (${locale})`,async()=>{
  await i18n.changeLanguage(locale);vi.spyOn(projectService,"getProject").mockRejectedValue(temporary());const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});client.setQueryData(["project","task",locale],task);client.setQueryData(["form-options",locale],catalog);const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
   await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/task`]}><Routes><Route path="/:locale/tasks/:taskId" element={<TaskDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>));const details=host.querySelector(".detail-page");expect(details).not.toBeNull();const delivery=host.querySelector("[data-delivery]");
   await act(async()=>client.refetchQueries({queryKey:["project","task",locale]}));await settle();expect(host.querySelector(".detail-page")).toBe(details);expect(host.querySelector("[data-delivery]")).toBe(delivery);expect(host.textContent).toContain(i18n.t("recovery.refreshFailed"));
   vi.mocked(projectService.getProject).mockRejectedValue(rejected());await act(async()=>client.refetchQueries({queryKey:["project","task",locale]}));await settle();expect(host.querySelector(".detail-page")).toBeNull();expect(host.querySelector('[role="alert"]')).not.toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();client.clear();}
 });
 it(`shows an initial loading failure without pretending cached data exists (${locale})`,async()=>{
  await i18n.changeLanguage(locale);vi.spyOn(authService,"getCurrentUser").mockRejectedValue(temporary());const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const host=document.createElement("div");const root=createRoot(host);
  try{await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/profile`]}><Routes><Route path="/:locale" element={<ProtectedLayout/>}><Route path="profile" element={<ProfilePage/>}/></Route></Routes></MemoryRouter></QueryClientProvider>));await settle();expect(host.querySelector(".profile-page")).toBeNull();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain(i18n.t("recovery.refreshFailed"));}
  finally{await act(async()=>root.unmount());host.remove();client.clear();}
 });
}
it("never treats authentication failures or missing records as a recoverable refresh",()=>{
 expect(canRetainQueryData(new ApiError({code:"auth.account_changed",retryable:true}))).toBe(false);expect(canRetainQueryData(new ApiError({code:"project.not_found",retryable:false}))).toBe(false);expect(canRetainQueryData(rejected())).toBe(false);expect(canRetainQueryData(temporary())).toBe(true);
});
