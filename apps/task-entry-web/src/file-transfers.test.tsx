import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { FileTransfers, type FileTransfer } from "./components/FileTransfers";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("per-file transfer feedback", () => {
  it.each(["zh-CN", "en-US"])("shows actual progress, processing, failure and retry (%s)", async locale => {
    await i18n.changeLanguage(locale);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const file = new File(["png"], "<img src=x onerror=alert(1)>.png");
    const item: FileTransfer = { id: "one", categoryId: "book-cover", file, status: "uploading", progress: 42 };
    const onCancel = vi.fn(); const onRetry = vi.fn().mockResolvedValue(undefined);
    const render = (entry: FileTransfer, busy = true) => act(() => root.render(<FileTransfers items={[entry]} busy={busy} onCancel={onCancel} onRetry={onRetry} />));
    try {
      render(item);
      expect(host.querySelector("progress")!.value).toBe(42);
      expect(host.textContent).toContain(i18n.t("fileTransfer.progress", { percent: 42 }));
      expect(host.querySelector("img")).toBeNull();
      act(() => host.querySelector("button")!.click()); expect(onCancel).toHaveBeenCalledWith("one");
      render({ ...item, progress: 100 }); expect(host.textContent).toContain(i18n.t("fileTransfer.processing"));
      const failed: FileTransfer = { ...item, status: "error", error: "Network unavailable" };
      render(failed, false); expect(host.querySelector("progress")).toBeNull();
      await act(async () => host.querySelector("button")!.click()); expect(onRetry).toHaveBeenCalledWith(failed);
      render(failed, true); expect(host.querySelector("button")!.disabled).toBe(true);
      expect(host.querySelectorAll("button")[1].disabled).toBe(true);
      render(failed, false);
      act(() => host.querySelectorAll("button")[1].click()); expect(onCancel).toHaveBeenCalledTimes(2);
    } finally { act(() => root.unmount()); host.remove(); }
  });
});
