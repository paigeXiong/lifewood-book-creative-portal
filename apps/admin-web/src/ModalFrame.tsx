import { useEffect, useRef, type ReactNode } from "react";

const focusableSelector = [
  "a[href]",
  "summary",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalFrame({ labelledBy, className = "", busy = false, onClose, children }: { labelledBy: string; className?: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(focusableSelector);
    (focusable?.[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => !item.hasAttribute("disabled") && item.getClientRects().length > 0);
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className={"modal " + className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>{children}</section>
  </div>;
}
