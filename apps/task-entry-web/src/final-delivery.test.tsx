import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { projectService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { FinalDelivery, SupportedLocale } from "@lifewood/domain";
import { FinalDeliverySection } from "./components/FinalDeliverySection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original: FinalDelivery = { id: "v1", projectId: "task", fileName: "original.mp4", contentType: "video/mp4", sizeBytes: 1000000, publishedAt: "2026-09-07T00:00:00Z" };

describe("current final delivery", () => {
 it.each<SupportedLocale>(["zh-CN", "en-US"])("refreshes replacement and revocation without reopening the page in %s", async locale => {
  await i18n.changeLanguage(locale);
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["project-deliveries", "task", locale], [original]);
  const replacement = { ...original, id: "v2", fileName: "replacement.mp4" };
  const get = vi.spyOn(projectService, "listDeliveries").mockResolvedValue([replacement]);
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  try {
   await act(async () => root.render(<QueryClientProvider client={client}><FinalDeliverySection projectId="task" locale={locale}/></QueryClientProvider>));
   expect(c.textContent).toContain("original.mp4");
   expect(get).not.toHaveBeenCalled();
   await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
   expect(get).toHaveBeenCalledWith("task", locale);
   expect(c.textContent).toContain("replacement.mp4");
   expect(c.textContent).not.toContain("original.mp4");
   expect(c.querySelector("a")!.getAttribute("href")).toContain("/v2/file");
   get.mockResolvedValue([]);
   await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
   expect(c.querySelector("a")).toBeNull();
   expect(c.querySelector(".customer-delivery.pending")).not.toBeNull();
   expect(c.textContent).toContain(i18n.t("delivery.pendingTitle"));
  } finally {
   await act(async () => root.unmount());
   client.clear(); c.remove(); get.mockRestore();
   focusManager.setFocused(undefined); vi.useRealTimers();
  }
 });
});
