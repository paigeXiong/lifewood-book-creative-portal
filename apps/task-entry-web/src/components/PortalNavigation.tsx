import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";

/** One indicator follows the active link; feedback never delays navigation. */
export function PortalNavigation({ children, label }: PropsWithChildren<{ label: string }>) {
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const clicked = useRef<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, width: 0, visible: false });
  const pulse = () => {
    animation.current?.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !line.current?.animate) return;
    animation.current = line.current.animate([
      { transform: "scaleX(1)", offset: 0, easing: "ease-out" },
      { transform: "scaleX(.38)", offset: .3, easing: "ease-out" },
      { transform: "scaleX(1.08)", offset: .72, easing: "ease-in-out" },
      { transform: "scaleX(1)", offset: 1 },
    ], { duration: 380, easing: "linear" });
    animation.current.id = "portal-nav-press";
  };
  useLayoutEffect(() => {
    const container = nav.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      const text = active?.querySelector('span');
      if (!active || !text) { setPosition(previous => ({ ...previous, visible: false })); return; }
      const parent = container.getBoundingClientRect(), item = active.getBoundingClientRect(), bounds = text.getBoundingClientRect();
      setPosition({ x: bounds.left - parent.left + container.scrollLeft, y: item.bottom - parent.top + container.scrollTop - 5, width: bounds.width, visible: true });
    };
    measure();
    const active = container.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    if (clicked.current && active?.href === clicked.current) pulse();
    clicked.current = null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
    container.querySelectorAll('a').forEach(link => observer?.observe(link));
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [location.pathname, location.search, children]);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { if (reduced.matches) animation.current?.cancel(); };
    reduced.addEventListener("change", stop);
    return () => { reduced.removeEventListener("change", stop); animation.current?.cancel(); };
  }, []);
  const feedback = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a');
    if (!link || !nav.current?.contains(link) || link.getAttribute('aria-disabled') === 'true') return;
    clicked.current = link.href;
    if (link.getAttribute('aria-current') === 'page') { pulse(); clicked.current = null; }
  };
  return <nav ref={nav} className="portal-primary-nav" aria-label={label} onClickCapture={feedback}>
    {children}
    <span className="portal-nav-indicator" aria-hidden="true" style={{ width: position.width, transform: `translate3d(${position.x}px, ${position.y}px, 0)`, opacity: position.visible ? 1 : 0 }}>
      <span ref={line} className="portal-nav-indicator-line" />
    </span>
  </nav>;
}
