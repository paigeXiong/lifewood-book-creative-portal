// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { adminService, ApiError } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { AuditPage } from "./AuditPage";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(["zh-CN","en-US"] as const)("cancels old-filter exports, then retries current-filter errors in %s",async locale=>{
 await i18n.changeLanguage(locale);
 vi.spyOn(adminService,"listAuditActions").mockResolvedValue([]);
 vi.spyOn(adminService,"listAuditEvents").mockResolvedValue({items:[],total:1,page:1,pageSize:30});
 let finish!:(blob:Blob)=>void;
 const exporter=vi.spyOn(adminService,"exportAuditEvents").mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(new ApiError({code:"storage.quota",messageKey:"errors.storage.quota",retryable:true})).mockResolvedValue(new Blob(["csv"]));
 const create=vi.fn(()=>"blob:audit");vi.stubGlobal("URL",class extends URL {static createObjectURL=create;static revokeObjectURL=vi.fn();});vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 let navigate!:ReturnType<typeof useNavigate>;
 function Page(){navigate=useNavigate();return <AuditPage locale={locale} userId="owner"/>;}
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 const button=(key:string)=>[...c.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===i18n.t(key));
 try {
  await act(async()=>{root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={["/audit?q=first"]}><Page/></MemoryRouter></QueryClientProvider>);await settle();});
  await act(async()=>{await settle();});
  await act(async()=>{const exportButton=button("auditTools.export")!;exportButton.click();exportButton.click();await settle();});
  expect(exporter).toHaveBeenCalledOnce();expect(button("common.cancel")).toBeDefined();
  const signal=exporter.mock.calls[0][2]!;
  await act(async()=>{navigate("/audit?q=second");await settle();});
  expect(signal.aborted).toBe(true);
  await act(async()=>{finish(new Blob(["old"]));await settle();});expect(create).not.toHaveBeenCalled();
  await act(async()=>{button("auditTools.export")!.click();await settle();});
  expect(exporter.mock.calls[1][0].search).toBe("second");expect(exporter.mock.calls[1][1]).toBe(locale);
  expect(c.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.storage.quota"));
  expect(button("auditTools.export")!.disabled).toBe(false);
  await act(async()=>{button("auditTools.export")!.click();await settle();});
  expect(create).toHaveBeenCalledOnce();expect(c.querySelector('[role="alert"]')).toBeNull();
 } finally {await act(async()=>root.unmount());c.remove();cache.clear();}
});
