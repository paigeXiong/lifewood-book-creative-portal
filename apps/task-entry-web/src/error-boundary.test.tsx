import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@lifewood/ui/error-boundary";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("application error boundary", () => {
  it("shows a safe recovery screen when rendering fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Broken = () => { throw new Error("sensitive implementation detail"); };

    act(() => {
      root.render(<AppErrorBoundary labels={{ title: "Unable to display", description: "Try again.", reload: "Reload" }}><Broken /></AppErrorBoundary>);
    });

    expect(container.textContent).toContain("Unable to display");
    expect(container.textContent).toContain("Reload");
    expect(container.textContent).not.toContain("sensitive implementation detail");
  });
});
