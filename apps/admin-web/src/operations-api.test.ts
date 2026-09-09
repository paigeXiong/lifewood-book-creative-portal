import {afterEach,beforeEach,expect,it,vi} from "vitest";
beforeEach(()=>vi.resetModules());
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("downloads a ZIP through account binding, CSRF and locale headers",async()=>{
  const api=await import("@lifewood/api-client");
  const fetchMock=vi.fn(async(url:string)=>new Response(url.endsWith("/auth/csrf")?JSON.stringify({token:"secure"}):url.endsWith("/me")?JSON.stringify({id:"operator"}):"zip",{status:200}));
  vi.stubGlobal("fetch",fetchMock);
  await api.authService.getCurrentUser();
  const controller=new AbortController();
  const blob=await api.operationsService.export("project","en-US",controller.signal);
  expect(await blob.text()).toBe("zip");
  const [url,options]=fetchMock.mock.calls.at(-1) as unknown as [string,RequestInit];
  expect(url).toBe("/api/admin/projects/project/export");expect(options.method).toBe("POST");expect(options.signal).toBe(controller.signal);
  const headers=new Headers(options.headers);expect(headers.get("X-CSRF-TOKEN")).toBe("secure");expect(headers.get("X-LW-Account")).toBe("operator");expect(headers.get("Accept-Language")).toBe("en-US");
});
it("discards an export completed after the account changed",async()=>{
  const api=await import("@lifewood/api-client");
  let finish!: (blob:Blob)=>void;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.endsWith("/auth/csrf")?new Response(JSON.stringify({token:"secure"})):{ok:true,status:200,blob:()=>new Promise<Blob>(resolve=>{finish=resolve;})}));
  const pending=api.operationsService.export("project","zh-CN",new AbortController().signal);
  await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));api.authService.notifyAccountChanged();finish(new Blob(["zip"]));
  await expect(pending).rejects.toMatchObject({details:{code:"auth.account_changed"}});
});
it("keeps localized JSON errors when a ZIP request fails",async()=>{
  const api=await import("@lifewood/api-client");
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.endsWith("/auth/csrf")?new Response(JSON.stringify({token:"secure"})):new Response(JSON.stringify({code:"export.files",messageKey:"operations.exportFiles"}),{status:409})));
  await expect(api.operationsService.export("project","en-US",new AbortController().signal)).rejects.toMatchObject({details:{messageKey:"operations.exportFiles"}});
});
