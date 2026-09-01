import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectCover } from "./pages/TaskListPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("project cover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderCover = (coverUrl?: string | null) => {
    act(() => root.render(<ProjectCover coverUrl={coverUrl} pendingLabel="Cover pending" />));
  };

  it("shows the visual fallback only when no cover exists", () => {
    renderCover();

    const fallback = container.querySelector("img");
    expect(fallback?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(fallback?.getAttribute("alt")).toBe("Cover pending");
    expect(fallback?.classList.contains("cover-placeholder")).toBe(true);
  });

  it("does not expose the pending label when the cover is available", () => {
    renderCover("/covers/first.webp");

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/covers/first.webp");
    expect(container.querySelector("img")?.classList.contains("cover-placeholder")).toBe(false);
  });

  it("falls back after an error and retries when the cover URL changes", () => {
    renderCover("/covers/broken.webp");
    act(() => container.querySelector("img")?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Cover pending");

    renderCover("/covers/recovered.webp");

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/covers/recovered.webp");
  });
});
