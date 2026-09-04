import { useCallback } from "react";
import { useLocation, useNavigate, type NavigateOptions, type To } from "react-router-dom";

const steps = ["project", "characters", "voice", "style", "references", "review"];

export function wizardDirection(from: string, to: string): "forward" | "back" | undefined {
  const pattern = /^\/(zh-CN|en-US)\/tasks\/([^/]+)\/edit\/([^/?#]+)\/?$/;
  const previous = pattern.exec(from);
  const next = pattern.exec(to);
  if (!previous || !next || previous[1] !== next[1] || previous[2] !== next[2]) return;
  const a = steps.indexOf(previous[3]);
  const b = steps.indexOf(next[3]);
  if (a < 0 || b < 0 || a === b) return;
  return b > a ? "forward" : "back";
}

export function useWizardNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback((to: To, options?: NavigateOptions) => {
    const path = typeof to === "string" ? to.split(/[?#]/)[0] : to.pathname ?? location.pathname;
    const animate = Boolean(wizardDirection(location.pathname, path)) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    return navigate(to, { ...options, viewTransition: animate });
  }, [navigate, location.pathname]);
}
