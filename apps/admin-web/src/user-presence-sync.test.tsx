// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider,useQuery} from "@tanstack/react-query";
import {expect,it,vi} from "vitest";
import {usePresenceDirectorySync} from "./UserActivity";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("replaces an initial pre-heartbeat response and ignores its late offline result",async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 let resolveOld!:(value:string)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise<string>(r=>{resolveOld=r;})).mockResolvedValue("online");
 function Fixture(){usePresenceDirectorySync();const q=useQuery({queryKey:["admin-users"],queryFn:fetch});return <span>{q.data??"loading"}</span>;}
 const host=document.createElement("div"),root=createRoot(host);
 try{
  await act(async()=>{root.render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);});
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async()=>{window.dispatchEvent(new Event("lw-presence-updated"));await new Promise(r=>setTimeout(r,20));});
  expect(fetch).toHaveBeenCalledTimes(2);expect(client.getQueryData(["admin-users"])).toBe("online");
  await act(async()=>{resolveOld("offline");await new Promise(r=>setTimeout(r,20));});
  expect(client.getQueryData(["admin-users"])).toBe("online");expect(host.textContent).toBe("online");
 }finally{await act(async()=>root.unmount());client.clear();}
});
