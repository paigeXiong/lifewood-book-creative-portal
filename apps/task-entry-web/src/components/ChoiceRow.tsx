import { useRef, type HTMLAttributes, type PointerEvent } from "react";

export function ChoiceRow({ children, className = "", onFocus, ...props }: HTMLAttributes<HTMLDivElement>) {
  const drag = useRef<{ id: number; startX: number; scrollLeft: number; lastX: number; lastTime: number; velocity: number } | null>(null);
  const dragged = useRef(false);

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    const row = event.currentTarget;
    delete row.dataset.dragging;
    if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
    if (!cancelled && dragged.current && event.timeStamp - current.lastTime < 100 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.scrollBy({ left: Math.max(-300, Math.min(300, -current.velocity * 140)), behavior: "smooth" });
    }
  };

  return <div {...props} className={`choice-row ${className}`.trim()}
    onFocus={event => {
      onFocus?.(event);
      if (event.defaultPrevented) return;
      const chip = event.target.closest<HTMLElement>(".choice-chip");
      if (chip && event.currentTarget.contains(chip)) chip.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    }}
    onPointerDown={(event) => {
      dragged.current = false;
      if (event.pointerType !== "mouse" || event.button !== 0 || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
      drag.current = { id: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0 };
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (!(event.buttons & 1)) { finish(event, true); return; }
      const offset = event.clientX - current.startX;
      if (!dragged.current && Math.abs(offset) < 6) return;
      if (!dragged.current) {
        dragged.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = "true";
      }
      event.preventDefault();
      const elapsed = event.timeStamp - current.lastTime;
      if (elapsed > 0) current.velocity = (event.clientX - current.lastX) / elapsed;
      current.lastX = event.clientX;
      current.lastTime = event.timeStamp;
      event.currentTarget.scrollLeft = current.scrollLeft - offset;
    }}
    onPointerUp={(event) => finish(event)}
    onPointerCancel={(event) => finish(event, true)}
    onLostPointerCapture={(event) => finish(event, true)}
    onDragStart={(event) => event.preventDefault()}
    onClickCapture={(event) => {
      if (dragged.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
    }}
  >{children}</div>;
}
