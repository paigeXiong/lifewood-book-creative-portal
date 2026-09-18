import { useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

/** Move between selected links without animating initial placement or layout changes. */
export function PortalNavigation({ children, label }: PropsWithChildren<{ label: string }>) {
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, width: 0, visible: false, href: "", animate: false });
  useLayoutEffect(() => {
    const container = nav.current;
    if (!container) return;
    const measure = (navigation = false) => {
      const active = container.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      const text = active?.querySelector('span');
      if (!active || !text) {
        setPosition(previous => previous.visible ? { ...previous, visible: false, animate: false } : previous);
        return;
      }
      const parent = container.getBoundingClientRect(), item = active.getBoundingClientRect(), bounds = text.getBoundingClientRect();
      const next = { x: bounds.left - parent.left + container.scrollLeft, y: item.bottom - parent.top + container.scrollTop - 5, width: bounds.width, visible: true, href: active.href };
      setPosition(previous => {
        if (previous.visible && previous.href === next.href && previous.x === next.x && previous.y === next.y && previous.width === next.width) return previous;
        return { ...next, animate: navigation && previous.visible && previous.href !== next.href };
      });
    };
    measure(true);
    const reflow = () => measure(false);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reflow);
    observer?.observe(container);
    container.querySelectorAll('a').forEach(link => observer?.observe(link));
    window.addEventListener("resize", reflow);
    document.fonts?.addEventListener("loadingdone", reflow);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reflow);
      document.fonts?.removeEventListener("loadingdone", reflow);
    };
  }, [location.pathname, location.search, children]);
  return <nav ref={nav} className="portal-primary-nav" aria-label={label}>
    {children}
    <span className="portal-nav-indicator" aria-hidden="true" data-animate={position.animate} style={{ width: position.width, transform: `translate3d(${position.x}px, ${position.y}px, 0)`, opacity: position.visible ? 1 : 0 }}>
      <span className="portal-nav-indicator-line" />
    </span>
  </nav>;
}
