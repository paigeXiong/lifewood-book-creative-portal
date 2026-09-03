import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChoiceRow } from "./components/ChoiceRow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("scrolling choices", () => {
  it("drags with momentum without selecting a chip, then permits normal selection", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const change = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      act(() => root.render(<ChoiceRow><label className="choice-chip"><input type="checkbox" onChange={change} /><span>Option</span></label></ChoiceRow>));
      const row = container.firstElementChild as HTMLDivElement;
      const input = row.querySelector("input")!;
      Object.defineProperties(row, { scrollWidth: { value: 1000 }, clientWidth: { value: 300 } });
      row.setPointerCapture = vi.fn(); row.hasPointerCapture = () => true; row.releasePointerCapture = vi.fn(); row.scrollBy = vi.fn();
      const pointer = (type: string, x: number, time: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" }, button: { value: 0 }, buttons: { value: type === "pointerup" ? 0 : 1 }, clientX: { value: x }, timeStamp: { value: time + 100 } });
        act(() => input.dispatchEvent(event));
      };
      pointer("pointerdown", 250, 0);
      pointer("pointermove", 150, 20);
      expect(row.scrollLeft).toBe(100);
      pointer("pointerup", 150, 30);
      expect(row.scrollBy).toHaveBeenCalledWith({ left: 300, behavior: "smooth" });
      act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
      expect(change).not.toHaveBeenCalled();
      expect(input.checked).toBe(false);
      pointer("pointerdown", 150, 40);
      pointer("pointerup", 150, 50);
      act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
      expect(change).toHaveBeenCalledOnce();
      expect(input.checked).toBe(true);
    } finally { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });
});
