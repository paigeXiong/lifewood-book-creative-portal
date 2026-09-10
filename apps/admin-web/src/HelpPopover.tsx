import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./help-popover.css";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = () => {
    if (!trigger.current || !popup.current?.matches(":popover-open")) return;
    const anchor = trigger.current.getBoundingClientRect();
    const size = popup.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left, innerWidth - size.width - 12));
    const below = anchor.bottom + 8;
    const top = Math.max(12, Math.min(below + size.height <= innerHeight - 12 ? below : anchor.top - size.height - 8, innerHeight - size.height - 12));
    popup.current.style.left = `${left}px`;
    popup.current.style.top = `${top}px`;
  };
  useEffect(() => {
    if (!open) return;
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="help-popover-trigger" aria-label={t("helpPopover.label", { label })} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined} popoverTarget={id} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>?</span></button>
    <div ref={popup} id={id} popover="auto" role="note" className="help-popover-content" onToggle={() => { const visible = popup.current?.matches(":popover-open") ?? false; setOpen(visible); if (visible) position(); }}>
      <strong>{label}</strong><div>{children}</div>
    </div>
  </>;
}
