import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { StylePreviewImage } from "./components/StylePreviewImage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("style preview images", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`plays video only on hover and falls back to its image in ${locale}`, async () => {
      await i18n.changeLanguage(locale);
      const container = document.createElement("div");
      const root = createRoot(container);
      let finishPlay!: () => void;
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>(resolve => { finishPlay = resolve; }));
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
      const option = { id: "cinematic", label: "Cinema", previewImageUrl: "/poster.jpg", previewVideoUrl: "/preview.mp4" };
      try {
        act(() => root.render(<StylePreviewImage option={option} className="style-swatch" />));
        const video = container.querySelector("video")!;
        expect(video.autoplay).toBe(false);
        expect(video.muted).toBe(true);
        expect(video.playsInline).toBe(true);
        expect(video.poster).toContain("/poster.jpg");
        expect(play).not.toHaveBeenCalled();
        act(() => video.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
        expect(play).toHaveBeenCalledOnce();
        act(() => video.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
        expect(pause).toHaveBeenCalled();
        const beforeResolve = pause.mock.calls.length;
        await act(async () => finishPlay());
        expect(pause.mock.calls.length).toBeGreaterThan(beforeResolve);
        act(() => video.dispatchEvent(new Event("error")));
        expect(container.querySelector("video")).toBeNull();
        expect(container.querySelector("img")?.getAttribute("src")).toBe(option.previewImageUrl);
        act(() => root.render(<StylePreviewImage option={{ ...option, previewVideoUrl: "/other.webm" }} className="style-swatch" />));
        expect(container.querySelector("video")?.getAttribute("src")).toBe("/other.webm");
      } finally { act(() => root.unmount()); play.mockRestore(); pause.mockRestore(); }
    });
    it(`renders the server image, handles failure and switches images in ${locale}`, async () => {
      await i18n.changeLanguage(locale);
      const container = document.createElement("div");
      const root = createRoot(container);
      const first = { id: "cinematic", label: "Cinematic", previewImageUrl: "/style-previews/cinematic-v1.jpg" };
      const second = { id: "watercolor", label: "Watercolor", previewImageUrl: "/style-previews/watercolor-v1.jpg" };
      try {
        act(() => root.render(<StylePreviewImage option={first} className="style-swatch" />));
        const image = container.querySelector("img")!;
        expect(image.getAttribute("src")).toBe(first.previewImageUrl);
        expect(image.alt).toBe(i18n.t("creative.stylePreview.alt", { style: first.label }));
        expect(image.width / image.height).toBe(16 / 9);
        act(() => image.dispatchEvent(new Event("error")));
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain(i18n.t("creative.stylePreview.unavailable"));
        act(() => root.render(<StylePreviewImage option={second} className="summary-swatch" />));
        expect(container.querySelector("img")?.getAttribute("src")).toBe(second.previewImageUrl);
        act(() => root.render(<StylePreviewImage option={{ id: "custom", label: "Custom" }} className="style-swatch" />));
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain(i18n.t("creative.stylePreview.unavailable"));
        for (const key of ["alt", "unavailable", "note"])
          expect(i18n.getResource(locale, "translation", `creative.stylePreview.${key}`)).toBeTypeOf("string");
      } finally { act(() => root.unmount()); }
    });
  }
});
