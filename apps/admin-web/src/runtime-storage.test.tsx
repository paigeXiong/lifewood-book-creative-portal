// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { describe,it,expect } from "vitest";
import { i18n } from "@lifewood/i18n";
import { RuntimeHealthPanel } from "./RuntimeHealthPanel";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe("storage breakdown",()=>{
 for(const locale of ["zh-CN","en-US"] as const)it(`separates backups from quota and handles missing values (${locale})`,async()=>{
  await i18n.changeLanguage(locale);
  const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});
  const health={startedAt:"2026-09-01T00:00:00Z",measuredAt:"2026-09-17T00:00:00Z",quotaBytes:1000,usedBytes:250,uploadBytes:100,deliveryBytes:50,databaseBytes:40,avatarBytes:20,otherBytes:40,backupBytes:900,storageComplete:true};
  client.setQueryData(["admin-runtime-health","owner"],health);
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  try {
   await act(async()=>root.render(<QueryClientProvider client={client}><RuntimeHealthPanel locale={locale} userId="owner"/></QueryClientProvider>));
   expect(container.querySelector('.runtime-storage-ring')?.textContent).toBe("25%");
   for(const key of ["databaseFiles","avatars","otherFiles","backups"])expect(container.textContent).toContain(i18n.t(`runtimeHealth.${key}`));
   expect(container.querySelector('.help-popover-content')?.textContent).toContain(i18n.t("runtimeHealth.breakdownHelp"));
   await act(async()=>{client.setQueryData(["admin-runtime-health","owner"],{...health,backupBytes:undefined});await new Promise(resolve=>setTimeout(resolve,10));});
   const entry=Array.from(container.querySelectorAll('dl>div')).find(el=>el.querySelector('dt')?.textContent===i18n.t("runtimeHealth.backups"));
   expect(entry?.querySelector('dd')?.textContent).toBe(i18n.t("runtimeHealth.unknown"));
  } finally {await act(async()=>root.unmount());client.clear();container.remove();}
 });
});
