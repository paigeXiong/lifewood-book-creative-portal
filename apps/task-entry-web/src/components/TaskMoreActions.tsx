import { useId, useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";

export function TaskMoreActions({ label, children }: PropsWithChildren<{ label: string }>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const menu = panel.current;
      const below = rect.bottom + 6;
      menu.style.top = `${Math.max(8, below + menu.offsetHeight <= window.innerHeight - 8 ? below : rect.top - menu.offsetHeight - 6)}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    };
    position();
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="task-more-trigger" aria-label={label} title={label} popoverTarget={id} aria-controls={id} aria-expanded={open} aria-haspopup="dialog" data-icon-motion="press">
      <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
    </button>
    <div ref={panel} id={id} className="task-more-popover" popover="auto" role="dialog" aria-label={label} onToggle={event => setOpen(event.newState === "open")} onClick={event => {
      const button = (event.target as Element).closest('button');
      if (button && !button.disabled) panel.current?.hidePopover?.();
    }}>{children}</div>
  </>;
}
