import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./help-popover.css";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    if (!trigger.current || !popup.current?.matches(":popover-open")) return;
    const anchor = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0, topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    if (anchor.bottom <= topEdge || anchor.top >= topEdge + height || anchor.right <= leftEdge || anchor.left >= leftEdge + width) {
      popup.current.hidePopover();
      return;
    }
    for (let parent = trigger.current.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY), clipsX = /auto|scroll|hidden|clip/.test(style.overflowX);
      if ((clipsY && (anchor.bottom <= bounds.top + parent.clientTop || anchor.top >= bounds.top + parent.clientTop + parent.clientHeight))
        || (clipsX && (anchor.right <= bounds.left + parent.clientLeft || anchor.left >= bounds.left + parent.clientLeft + parent.clientWidth))) {
        popup.current.hidePopover();
        return;
      }
    }
    popup.current.style.maxWidth = `${Math.max(0, width - 24)}px`;
    popup.current.style.maxHeight = `${Math.max(0, height - 24)}px`;
    const size = popup.current.getBoundingClientRect();
    const left = Math.max(leftEdge + 12, Math.min(anchor.left, leftEdge + width - size.width - 12));
    const below = anchor.bottom + 8;
    const top = Math.max(topEdge + 12, Math.min(below + size.height <= topEdge + height - 12 ? below : anchor.top - size.height - 8, topEdge + height - size.height - 12));
    popup.current.style.left = `${left}px`;
    popup.current.style.top = `${top}px`;
  }, []);
  useLayoutEffect(() => { if (open) position(); }, [open, label, children, position]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !popup.current?.matches(":popover-open")) return;
      event.preventDefault(); event.stopPropagation();
      popup.current.hidePopover(); trigger.current?.focus();
    };
    const focus = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node) && popup.current?.matches(":popover-open")) popup.current.hidePopover();
    };
    // Capture Escape before the surrounding modal's close handler.
    window.addEventListener("keydown", escape, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    if (popup.current) observer.observe(popup.current);
    if (trigger.current) observer.observe(trigger.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", escape, true); document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position); window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, position]);
  return <>
    <button ref={trigger} type="button" className="help-popover-trigger" aria-label={t("helpPopover.label", { label })} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined} popoverTarget={id}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></svg></button>
    <div ref={popup} id={id} popover="auto" role="note" className="help-popover-content" onToggle={() => { const visible = popup.current?.matches(":popover-open") ?? false; setOpen(visible); if (visible) position(); }}>
      <strong>{label}</strong><div>{children}</div>
    </div>
  </>;
}
