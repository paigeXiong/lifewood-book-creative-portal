// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {presenceService} from "@lifewood/api-client";
import {installUserPresence} from "@lifewood/ui/user-presence";
let cleanup=()=>{};
function setup(){
 vi.useFakeTimers();vi.spyOn(document,"hasFocus").mockReturnValue(true);vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
 const heartbeat=vi.spyOn(presenceService,"heartbeat").mockResolvedValue();const leave=vi.spyOn(presenceService,"leave").mockResolvedValue();
 cleanup=installUserPresence("account");return {heartbeat,leave};
}
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it("mounts and polls without inventing user activity",async()=>{
 const {heartbeat}=setup();await vi.advanceTimersByTimeAsync(30000);
 expect(heartbeat).toHaveBeenCalledTimes(2);for(const call of heartbeat.mock.calls)expect(call[1]).toMatchObject({visible:true,interacted:false});
 window.dispatchEvent(new Event("pointerdown"));await vi.advanceTimersByTimeAsync(30000);expect(heartbeat.mock.lastCall?.[1].interacted).toBe(false);
});
it("reports background visibility and stops on account changes",async()=>{
 const {heartbeat}=setup();await vi.advanceTimersByTimeAsync(0);
 vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");document.dispatchEvent(new Event("visibilitychange"));await vi.advanceTimersByTimeAsync(200);
 expect(heartbeat.mock.lastCall?.[1]).toMatchObject({visible:false,interacted:false});
 window.dispatchEvent(new Event("lw-account-changed"));const calls=heartbeat.mock.calls.length;
 window.dispatchEvent(new Event("pageshow"));await vi.advanceTimersByTimeAsync(60000);expect(heartbeat).toHaveBeenCalledTimes(calls);
});
it("uses a fresh tab identity after page restoration and removes its listeners",async()=>{
 const {heartbeat,leave}=setup();await vi.advanceTimersByTimeAsync(0);const first=heartbeat.mock.calls[0][1].tabId;
 window.dispatchEvent(new Event("pagehide"));expect(leave).toHaveBeenLastCalledWith("account",first);
 window.dispatchEvent(new Event("pageshow"));await vi.advanceTimersByTimeAsync(0);
 expect(heartbeat.mock.lastCall?.[1].tabId).not.toBe(first);cleanup();const calls=heartbeat.mock.calls.length;
 window.dispatchEvent(new Event("focus"));await vi.advanceTimersByTimeAsync(60000);expect(heartbeat).toHaveBeenCalledTimes(calls);
});

it("keeps a visible page present while the address bar has focus",async()=>{
 const {heartbeat}=setup();await vi.advanceTimersByTimeAsync(0);
 vi.spyOn(document,"hasFocus").mockReturnValue(false);window.dispatchEvent(new Event("blur"));await vi.advanceTimersByTimeAsync(200);
 expect(heartbeat.mock.lastCall?.[1]).toMatchObject({visible:true,interacted:false});
});
it("announces only acknowledged live heartbeats for directory synchronization",async()=>{
 const listener=vi.fn();window.addEventListener("lw-presence-updated",listener);
 try{
  const {heartbeat}=setup();await vi.advanceTimersByTimeAsync(0);expect(listener).toHaveBeenCalledTimes(1);
  heartbeat.mockRejectedValueOnce(new Error("offline"));await vi.advanceTimersByTimeAsync(30000);expect(listener).toHaveBeenCalledTimes(1);
  let resolve!:()=>void;heartbeat.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  await vi.advanceTimersByTimeAsync(30000);cleanup();resolve();await vi.advanceTimersByTimeAsync(0);expect(listener).toHaveBeenCalledTimes(1);
 }finally{window.removeEventListener("lw-presence-updated",listener);}
});
