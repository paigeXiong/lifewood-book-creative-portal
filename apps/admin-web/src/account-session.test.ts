import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>vi.unstubAllGlobals());
it("pins delivery uploads and stops retries when the browser account changes",async()=>{
 vi.resetModules();const {authService,adminService}=await import("@lifewood/api-client");
 vi.stubGlobal("fetch",vi.fn(async(url:string,_options?:RequestInit)=>new Response(JSON.stringify(url.endsWith('/me')?{id:'admin-a'}:{token:'csrf'}),{status:200})));
 await authService.getCurrentUser();
 const xhr={upload:{},status:409,responseText:JSON.stringify({code:'auth.account_changed',messageKey:'accountSwitch.changed',retryable:false}),open:vi.fn(),setRequestHeader:vi.fn(),send:vi.fn(),abort:vi.fn(),withCredentials:false,onload:null as null|(()=>void)};
 xhr.send.mockImplementation(()=>queueMicrotask(()=>xhr.onload?.()));const construct=vi.fn(()=>xhr);vi.stubGlobal('XMLHttpRequest',construct);
 await expect(adminService.publishFinalDelivery('project',new File(['video'],'video.mp4'),'')).rejects.toMatchObject({details:{code:'auth.account_changed'}});
 expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-LW-Account','admin-a');
 await expect(adminService.publishFinalDelivery('project',new File(['video'],'video.mp4'),'')).rejects.toMatchObject({details:{code:'auth.account_changed'}});
 expect(construct).toHaveBeenCalledTimes(1);
});
it("pins ordinary API requests to the displayed account",async()=>{
 vi.resetModules();const {authService,projectService}=await import("@lifewood/api-client");
 const fetch=vi.fn(async(url:string,_options?:RequestInit)=>new Response(JSON.stringify(url.endsWith('/me')?{id:'customer-a'}:{total:0,drafts:0,active:0,completed:0,actionRequired:0}),{status:200}));vi.stubGlobal('fetch',fetch);
 await authService.getCurrentUser();await projectService.getStats();
 const options=fetch.mock.calls.at(-1)![1] as RequestInit;
 expect(new Headers(options.headers).get('X-LW-Account')).toBe('customer-a');
});
