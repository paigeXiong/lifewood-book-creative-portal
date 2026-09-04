import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { LoginStory } from "./components/LoginStory";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("login showcase", () => {
  for (const locale of ["zh-CN", "en-US"]) it(`loops automatically, resets after manual navigation and respects pause and reduced motion (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    vi.useFakeTimers();
    let reduced = false;
    let onMotionChange: (() => void) | undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query.includes("reduced-motion") ? reduced : true; },
      addEventListener: (_: string, listener: () => void) => { if (query.includes("reduced-motion")) onMotionChange = listener; },
      removeEventListener: vi.fn(),
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LoginStory />));
      const current = () => [...container.querySelectorAll("button")].findIndex(button => button.hasAttribute("aria-current"));
      const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)); };
      for (const expected of [1, 2, 0]) {
        await advance(6500);
        expect(current()).toBe(expected);
      }
      await advance(5000);
      await act(async () => container.querySelectorAll("button")[1].click());
      await advance(1500);
      expect(current()).toBe(1);
      await advance(5000);
      expect(current()).toBe(2);
      const toggle = () => [...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === i18n.t("auth.pauseStory"))!;
      await act(async () => toggle().click());
      await advance(20000);
      expect(current()).toBe(2);
      await act(async () => container.querySelectorAll("button")[3].click());
      await advance(6500);
      expect(current()).toBe(0);
      await act(async () => { reduced = true; onMotionChange?.(); });
      await advance(20000);
      expect(current()).toBe(0);
      await act(async () => container.querySelectorAll("button")[2].click());
      expect(current()).toBe(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  for (const locale of ["zh-CN", "en-US"]) it(`handles wheel gestures without skipping or trapping mobile scrolling (${locale})`, async () => {
    await i18n.changeLanguage(locale);
    let now = 1000;
    let desktop = true;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") ? desktop : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LoginStory />));
      const story = container.querySelector("section")!;
      const current = () => [...container.querySelectorAll("button")].findIndex(button => button.hasAttribute("aria-current"));
      const wheel = async (deltaY: number, ctrlKey = false) => {
        const event = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
        await act(async () => { story.dispatchEvent(event); });
        return event;
      };
      expect((await wheel(80)).defaultPrevented).toBe(true);
      expect(current()).toBe(1);
      now += 250;
      await wheel(240);
      expect(current()).toBe(1);
      now += 1000;
      await wheel(80);
      expect(current()).toBe(2);
      now += 1000;
      await wheel(80);
      expect(current()).toBe(2);
      now += 1000;
      expect((await wheel(-80, true)).defaultPrevented).toBe(false);
      expect(current()).toBe(2);
      desktop = false;
      expect((await wheel(-80)).defaultPrevented).toBe(false);
      await act(async () => container.querySelector("button")!.click());
      expect(current()).toBe(0);
      expect(container.querySelectorAll('[aria-hidden="false"]')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
