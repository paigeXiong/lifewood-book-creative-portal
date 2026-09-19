// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {createMemoryRouter,RouterProvider} from "react-router-dom";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {invitationService} from "@lifewood/api-client";
import {i18n} from "@lifewood/i18n";
import "./i18n";
import {InvitationsPage} from "./InvitationsPage";
vi.mock("./organization-loader",()=>({loadAllOrganizations:()=>Promise.resolve([{id:"org",name:"Demo team",active:true}])}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,client:QueryClient,router:ReturnType<typeof createMemoryRouter>;
const settle=async()=>act(async()=>{await new Promise(r=>setTimeout(r,25));});
beforeEach(async()=>{const {transferableAbortController}=await vi.importActual<{transferableAbortController:()=>AbortController}>("node:util");vi.stubGlobal("AbortController",class{constructor(){return transferableAbortController();}});host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.spyOn(invitationService,"list").mockResolvedValue({items:[{id:"invite",organizationId:"org",organization:"Demo team",note:"Welcome",creator:"Owner",createdAt:1800000000,expires:1800003600,limit:1,used:0,status:"active",suffix:"ABCD"}],total:1,page:1,pageSize:20});vi.spyOn(invitationService,"create").mockResolvedValue({code:"secret-code"});});
afterEach(async()=>{await act(async()=>root.unmount());router.dispose();client.clear();host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(locale:"zh-CN"|"en-US"){await i18n.changeLanguage(locale);router=createMemoryRouter([{path:"*",element:<InvitationsPage locale={locale}/>}],{initialEntries:[`/${locale}/invitations?organization=org`]});await act(async()=>root.render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>));await settle();}
for(const locale of ["zh-CN","en-US"] as const){it(`keeps organization context and hides full codes (${locale})`,async()=>{await mount(locale);expect(invitationService.list).toHaveBeenCalledWith("","","org",1);expect(host.textContent).toContain("•••• ABCD");expect(host.textContent).not.toContain("secret-code");await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent===i18n.t("invitation.create"))!.click();});await settle();expect(host.querySelector<HTMLSelectElement>('select[name="organization"]')!.value).toBe("org");expect(host.querySelector<HTMLInputElement>('input[name="limit"]')!.value).toBe("1");await act(async()=>{host.querySelector(".invitation-form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});await settle();expect(invitationService.create).toHaveBeenCalledWith({organizationId:"org",note:"",days:7,limit:1},expect.anything());expect(host.querySelector<HTMLInputElement>(".invitation-secret")?.value).toBe("secret-code");});}
