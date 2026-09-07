import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider, Link } from "react-router-dom";
import { i18n } from "@lifewood/i18n";
import { showConfirmation } from "@lifewood/ui/confirmation";
import { UnsavedChangesGuard } from "./components/UnsavedChangesGuard";
import { useConfirmLink } from "./useConfirm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let show: PropertyDescriptor | undefined, close: PropertyDescriptor | undefined;
beforeEach(async () => {
  const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util");
  vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } });
  show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"); close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if(show) Object.defineProperty(HTMLDialogElement.prototype,"showModal",show); else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");
  if(close) Object.defineProperty(HTMLDialogElement.prototype,"close",close); else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");
});
const click = async (selector: string) => { await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click()); };

for (const locale of ["zh-CN", "en-US"] as const) {
 describe(`confirmation ${locale}`, () => {
  it("escapes text, defaults to cancel, prevents duplicate dialogs and cancels on scope abort", async () => {
    await i18n.changeLanguage(locale);
    const controller = new AbortController();
    const labels = { title: i18n.t("common.confirmTitle"), confirm: i18n.t("common.confirmAction"), cancel: i18n.t("common.cancel") };
    const first = showConfirmation("<img src=x onerror=alert(1)>", labels, controller.signal);
    expect(document.querySelector(".app-confirmation img")).toBeNull();
    expect(document.activeElement?.textContent).toBe(labels.cancel);
    expect(await showConfirmation("duplicate", labels, controller.signal)).toBe(false);
    expect(document.querySelectorAll(".app-confirmation")).toHaveLength(1);
    controller.abort(); expect(await first).toBe(false);
    expect(document.querySelector(".app-confirmation")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the dirty form mounted on cancelled Back, then allows confirmed navigation", async () => {
    await i18n.changeLanguage(locale);
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    function Editor() { return <><UnsavedChangesGuard dirty /><input defaultValue="unsaved data" /></>; }
    const router = createMemoryRouter([{ path:"/home",element:<p>Home</p> },{ path:"/edit",element:<Editor/> }],{initialEntries:["/home","/edit"]});
    try {
      await act(async () => root.render(<RouterProvider router={router}/>));
      await act(async () => { await router.navigate(-1); });
      expect(router.state.location.pathname).toBe("/edit");
      expect(document.querySelector(".app-confirmation")?.textContent).toContain(i18n.t("wizard.unsavedChanges"));
      await click(".app-confirmation-actions button:first-child");
      expect(router.state.location.pathname).toBe("/edit");
      expect(container.querySelector("input")?.value).toBe("unsaved data");
      await act(async () => { await router.navigate(-1); });
      await click(".app-confirmation-actions button:last-child");
      expect(router.state.location.pathname).toBe("/home");
    } finally { await act(async () => root.unmount()); router.dispose(); container.remove(); }
  });

  it("waits for link confirmation and cleans up a pending dialog when the page unmounts", async () => {
    await i18n.changeLanguage(locale);
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    function Editor() { const guard = useConfirmLink(); const [dirty] = useState(true); return <><UnsavedChangesGuard dirty={dirty}/><Link to="/home" onClick={guard}>Leave</Link></>; }
    const router = createMemoryRouter([{ path:"/home",element:<p>Home</p> },{ path:"/edit",element:<Editor/> }],{initialEntries:["/edit"]});
    try {
      await act(async () => root.render(<RouterProvider router={router}/>));
      await click("a");
      expect(router.state.location.pathname).toBe("/edit");
      await click(".app-confirmation-actions button:last-child");
      expect(router.state.location.pathname).toBe("/home");
      await act(async () => { await router.navigate("/edit"); });
      await click("a");
      await act(async () => root.unmount());
      expect(document.querySelector(".app-confirmation")).toBeNull();
      expect(router.state.location.pathname).toBe("/edit");
    } finally { await act(async () => root.unmount()); router.dispose(); container.remove(); }
  });
 });
}
