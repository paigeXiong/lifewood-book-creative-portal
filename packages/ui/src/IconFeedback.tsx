import { useEffect } from "react";
import "./icon-feedback.css";

type Motion = "press" | "pop" | "ring" | "refresh";
const frames: Record<Motion, string[]> = {
  press: ["scale(1)", "scale(.82)", "scale(1.06)", "scale(1)"],
  pop: ["translateY(0) scale(1)", "translateY(-2px) scale(1.12)", "translateY(1px) scale(.97)", "translateY(0) scale(1)"],
  ring: ["rotate(0)", "rotate(20deg)", "rotate(-17deg)", "rotate(11deg)", "rotate(-6deg)", "rotate(0)"],
  refresh: ["rotate(0)", "rotate(360deg)"],
};

/** Decorative feedback only. Business handlers remain synchronous and independent. */
export function installIconFeedback(doc: Document = document) {
  const view = doc.defaultView;
  if (!view?.matchMedia) return () => {};
  const reduced = view.matchMedia("(prefers-reduced-motion: reduce)");
  const active = new Map<Element, Animation>();
  const stop = () => { for (const animation of active.values()) animation.cancel(); active.clear(); };
  const onMotionPreference = () => { if (reduced.matches) stop(); };
  const onClick = (event: MouseEvent) => {
    if (reduced.matches || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>("button[data-icon-motion], summary[data-icon-motion]");
    if (!control || control.matches(":disabled") || control.getAttribute("aria-disabled") === "true" || control.closest("[inert]")) return;
    const kind = control.dataset.iconMotion as Motion;
    if (!Object.hasOwn(frames, kind)) return;
    const icon = control.querySelector<HTMLElement | SVGElement>(":scope > svg, :scope > [data-icon-glyph], :scope > span[aria-hidden='true']");
    if (!icon?.animate) return;
    active.get(icon)?.cancel();
    const base = view.getComputedStyle(icon).transform;
    const prefix = base === "none" ? "" : base + " ";
    const animation = icon.animate(frames[kind].map(transform => ({ transform: prefix + transform, transformOrigin: kind === "ring" ? "50% 15%" : "50% 50%" })), { duration: kind === "ring" ? 600 : kind === "refresh" ? 500 : 320, easing: "ease-in-out" });
    animation.id = "lw-icon-feedback";
    active.set(icon, animation);
    void animation.finished.catch(() => {}).finally(() => { if (active.get(icon) === animation) active.delete(icon); });
  };
  doc.addEventListener("click", onClick, true);
  reduced.addEventListener("change", onMotionPreference);
  return () => { doc.removeEventListener("click", onClick, true); reduced.removeEventListener("change", onMotionPreference); stop(); };
}

export function IconFeedback() {
  useEffect(() => installIconFeedback(), []);
  return null;
}
