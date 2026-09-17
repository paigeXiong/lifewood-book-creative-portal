import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationService as service } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { NotificationCenter, NoticeModal } from "@lifewood/ui/notifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let show: PropertyDescriptor | undefined, close: PropertyDescriptor | undefined;
beforeEach(() => {
  show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`preserves muted kinds through catalog failure and retry (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    const catalog = vi.spyOn(service, "catalog").mockRejectedValue(new Error("offline"));
    vi.spyOn(service, "list").mockResolvedValue({ items: [], nextCursor: null, unread: 0, watermark: 0 });
    const preferences = { toast: true, sound: false, quietStart: null, quietEnd: null, timeZone: "UTC", mutedKinds: ["workflow"] };
    vi.spyOn(service, "preferences").mockResolvedValue(preferences);
    const save = vi.spyOn(service, "savePreferences").mockResolvedValue(preferences);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    client.setQueryData(["current-user"], { id: "test-user" });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/notifications`]}><Routes><Route path="/:locale/notifications" element={<NotificationCenter />} /></Routes></MemoryRouter></QueryClientProvider>));
      await settle();
      await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("notifications.preferences")}"]`)!.click());
      await settle();
      const dialog = host.querySelector("dialog")!;
      const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      // A direct form submission must be guarded too, beyond the disabled button.
      await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(save).not.toHaveBeenCalled();
      expect(dialog.querySelector('[role="alert"]')).not.toBeNull();
      catalog.mockResolvedValue({ retentionDays: 365, items: [{ kind: "workflow", titleZh: "进度", titleEn: "Progress", level: "normal", enabled: true, allowMute: true, audience: "responsible", version: 1 }] });
      await act(async () => dialog.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("common.retry")}"]`)!.click());
      await settle();
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ mutedKinds: ["workflow"] }));
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });

  it(`keeps a busy modal open on Escape and allows closing after failure (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    let fail = () => {};
    function Editor() {
      const [busy, setBusy] = useState(true), [open, setOpen] = useState(true);
      fail = () => setBusy(false);
      return open ? <NoticeModal title="Editor" onClose={() => { if (!busy) setOpen(false); }}><p>{busy ? "Saving" : "Failed"}</p></NoticeModal> : null;
    }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<Editor />));
      const dialog = host.querySelector("dialog")!;
      const cancel = new Event("cancel", { bubbles: false, cancelable: true });
      await act(async () => { dialog.dispatchEvent(cancel); if (!cancel.defaultPrevented) dialog.close(); });
      expect(cancel.defaultPrevented).toBe(true);
      expect(dialog.open).toBe(true);
      await act(async () => fail());
      expect(dialog.textContent).toContain("Failed");
      await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
      expect(host.querySelector("dialog")).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it(`does not treat a file picker cancellation as closing its containing modal (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    const closeModal = vi.fn();
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<NoticeModal title={i18n.t("feedback.entry")} onClose={closeModal}><textarea defaultValue="Keep this feedback"/><input type="file"/></NoticeModal>));
      const dialog = host.querySelector("dialog")!;
      const file = host.querySelector("input")!;
      const fileCancel = new Event("cancel", { bubbles: true });
      await act(async () => file.dispatchEvent(fileCancel));
      expect(closeModal).not.toHaveBeenCalled();
      expect(dialog.open).toBe(true);
      expect(host.querySelector("textarea")!.value).toBe("Keep this feedback");
      const dialogCancel = new Event("cancel", { cancelable: true });
      await act(async () => dialog.dispatchEvent(dialogCancel));
      expect(dialogCancel.defaultPrevented).toBe(true);
      expect(closeModal).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

}

for (const locale of ["zh-CN", "en-US"] as const) {
  it(`keeps reply history reachable at the modal keyboard boundary (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function(this: HTMLElement) {
      return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
    });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<NoticeModal title="Feedback" onClose={() => {}}>
        <form><button type="submit">Save</button></form>
        <details><summary>Reply history</summary><p>Reply</p></details>
        <button disabled>Unavailable</button><button hidden>Hidden</button>
      </NoticeModal>));
      const closeButton = host.querySelector<HTMLButtonElement>("header button")!;
      const save = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const history = host.querySelector<HTMLElement>("summary")!;
      // jsdom does not implement the native summary tabIndex default.
      Object.defineProperty(history, "tabIndex", {value: 0});
      save.focus();
      const advance = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
      await act(async () => save.dispatchEvent(advance));
      // Native Tab must still be allowed to reach the history after the form.
      expect(advance.defaultPrevented).toBe(false);
      history.focus();
      const wrap = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
      await act(async () => history.dispatchEvent(wrap));
      expect(wrap.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(closeButton);
      await act(async () => closeButton.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", shiftKey: true, bubbles: true, cancelable: true})));
      expect(document.activeElement).toBe(history);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
}
