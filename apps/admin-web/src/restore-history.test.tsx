// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { adminService } from "@lifewood/api-client";
import type { RestoreHistoryPage } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { RestoreHistoryDialog } from "./RestoreHistoryDialog";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
for(const locale of ["zh-CN","en-US"] as const) it(`shows the terminal restore result when polling stops (${locale})`,async()=>{
  await i18n.changeLanguage(locale);
  const running:RestoreHistoryPage={items:[{id:"fixture",startedAt:"2026-09-10T06:00:00Z",updatedAt:"2026-09-10T06:00:01Z",actorName:"Operator",status:"checking"}],page:1,pageSize:20,total:1,incomplete:false,statuses:[{value:"",messageKey:"restore.history.all"}]};
  const failed:RestoreHistoryPage={...running,items:[{...running.items[0],status:"failed",errorCode:"space"}]};
  vi.spyOn(adminService,"restoreHistory").mockResolvedValueOnce(running).mockResolvedValue(failed);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const render=async(busy:boolean)=>{await act(async()=>root.render(<QueryClientProvider client={client}><RestoreHistoryDialog locale={locale} userId="owner" busy={busy} downloading={false} onDownload={()=>{}} onClose={()=>{}}/></QueryClientProvider>));};
  const settle=async()=>{for(let i=0;i<10;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});};
  try {await render(true);await settle();expect(container.querySelector("tbody")?.textContent).toContain(i18n.t("restore.states.checking"));await render(false);await settle();expect(container.querySelector("tbody")?.textContent).toContain(i18n.t("restore.states.failed"));expect(container.querySelector("tbody")?.textContent).not.toContain(i18n.t("restore.states.checking"));}
  finally {await act(async()=>root.unmount());container.remove();client.clear();vi.restoreAllMocks();}
});
