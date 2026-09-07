import { useCallback, useEffect, useRef } from "react";
import "./confirmation.css";

type Labels = { title: string; confirm: string; cancel: string };
let active = false;

export function showConfirmation(message: string, labels: Labels, signal: AbortSignal, danger = true): Promise<boolean> {
  if (signal.aborted || active) return Promise.resolve(false);
  active = true;
  return new Promise(resolve => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const dialog = document.createElement("dialog");
    dialog.className = "app-confirmation";
    dialog.setAttribute("aria-labelledby", "app-confirmation-title");
    dialog.setAttribute("aria-describedby", "app-confirmation-message");
    const heading = document.createElement("h2"); heading.id = "app-confirmation-title"; heading.textContent = labels.title;
    const text = document.createElement("p"); text.id = "app-confirmation-message"; text.textContent = message;
    const actions = document.createElement("div"); actions.className = "app-confirmation-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = labels.cancel;
    const accept = document.createElement("button"); accept.type = "button"; accept.textContent = labels.confirm;
    accept.className = danger ? "app-confirmation-danger" : "app-confirmation-primary";
    actions.append(cancel, accept); dialog.append(heading, text, actions);
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true; active = false;
      signal.removeEventListener("abort", abort);
      dialog.close(); dialog.remove(); document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      resolve(result);
    };
    const abort = () => finish(false);
    cancel.onclick = () => finish(false); accept.onclick = () => finish(true);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    // Keep the underlying editor's Escape and focus handlers from closing it too.
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.addEventListener("pointerdown", event => event.stopPropagation());
    signal.addEventListener("abort", abort, { once: true });
    document.body.append(dialog); document.body.style.overflow = "hidden";
    dialog.showModal(); cancel.focus();
  });
}

export function useConfirmation(labels: Labels) {
  const labelsRef = useRef(labels); labelsRef.current = labels;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => { controller.current?.abort(); controller.current = null; };
  }, []);
  return useCallback((message: string, danger = true) => controller.current
    ? showConfirmation(message, labelsRef.current, controller.current.signal, danger)
    : Promise.resolve(false), []);
}
