import type {KeyboardEvent} from "react";

export function containDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  if (!(event.target instanceof Element) || event.target.closest("dialog") !== dialog) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(":disabled")
      && element.closest("dialog") === dialog && !element.closest("[inert]")
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
  const active = document.activeElement;
  if (event.shiftKey ? active === first || active === dialog : active === last || active === dialog) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  }
}
