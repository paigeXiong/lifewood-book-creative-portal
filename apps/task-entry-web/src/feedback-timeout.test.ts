import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const input={id:"attempt",category:"bug",description:"Broken button",pagePath:"/en-US/tasks"};
it("times out a stalled CSRF lookup without sending feedback later",async()=>{
 vi.resetModules();vi.useFakeTimers();const {feedbackService}=await import("@lifewood/api-client");
 let complete!:(response:Response)=>void;
 const fetch=vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{complete=resolve;}));vi.stubGlobal("fetch",fetch);
 const result=feedbackService.submit(input).catch(error=>error);
 await vi.advanceTimersByTimeAsync(30000);expect(await result).toMatchObject({details:{code:"feedback.timeout",retryable:true}});
 complete(new Response(JSON.stringify({token:"token"})));await vi.advanceTimersByTimeAsync(1);
 expect(fetch).toHaveBeenCalledTimes(1);
});
it("aborts a stalled submission and leaves its idempotency key unchanged for retry",async()=>{
 vi.resetModules();vi.useFakeTimers();const {feedbackService}=await import("@lifewood/api-client");
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({token:"token"}))).mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal("fetch",fetch);
 const result=feedbackService.submit(input).catch(error=>error);await vi.advanceTimersByTimeAsync(1);
 const [,request]=fetch.mock.calls[1] as unknown as [string,RequestInit];expect(request.signal?.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(30000);expect(await result).toMatchObject({details:{code:"feedback.timeout"}});expect(request.signal?.aborted).toBe(true);
 fetch.mockResolvedValueOnce(new Response(null,{status:204}));await feedbackService.submit(input);
 expect(fetch.mock.calls.at(-1)?.[1].body).toBe(request.body);expect(vi.getTimerCount()).toBe(0);
});

it("starts a fresh CSRF lookup after timeout and ignores the late old token",async()=>{
 vi.resetModules();vi.useFakeTimers();const {feedbackService}=await import("@lifewood/api-client");let old!:(response:Response)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{old=resolve;})).mockResolvedValueOnce(new Response(JSON.stringify({token:"fresh"}))).mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal("fetch",fetch);
 const timedOut=feedbackService.submit(input).catch(error=>error);await vi.advanceTimersByTimeAsync(30000);expect(await timedOut).toMatchObject({details:{code:"feedback.timeout"}});
 await feedbackService.submit(input);expect(fetch).toHaveBeenCalledTimes(3);expect(new Headers(fetch.mock.calls[2][1].headers).get("X-CSRF-TOKEN")).toBe("fresh");
 old(new Response(JSON.stringify({token:"stale"})));await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(3);
 await feedbackService.submit({...input,id:"another"});expect(fetch).toHaveBeenCalledTimes(4);expect(new Headers(fetch.mock.calls[3][1].headers).get("X-CSRF-TOKEN")).toBe("fresh");
});
