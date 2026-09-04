import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import type { ReferenceAsset, ReferenceCategory } from "@lifewood/domain";
import { FileDropCard } from "./components/FileDropCard";
import { preparePhoto } from "./prepare-photo";

vi.mock("./prepare-photo", async importOriginal => ({
  ...await importOriginal<typeof import("./prepare-photo")>(),
  preparePhoto: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const category: ReferenceCategory = {
  id: "sample",
  label: "Sample",
  description: "PDF",
  accept: ["application/pdf"],
  maxBytes: 20_000_000,
  maxFiles: 2,
  allowsUrl: false,
  required: false,
};

const asset: ReferenceAsset = {
  id: "asset-1",
  categoryId: "sample",
  fileName: "sample.pdf",
  contentType: "application/pdf",
  sizeBytes: 1_000,
  url: "/files/sample.pdf",
};

function fileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
    *[Symbol.iterator]() { yield file; },
  } as FileList;
}

describe("file drop card", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.mocked(preparePhoto).mockReset();
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens the file picker from the whole card and from the keyboard target", () => {
    act(() => root.render(<FileDropCard inputId="sample-upload" category={category} files={[]} locale="en" onUpload={vi.fn()} onRemove={vi.fn()} />));
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const picker = vi.spyOn(input, "click").mockImplementation(() => undefined);

    act(() => container.querySelector<HTMLElement>(".upload-drop-card")!.click());
    expect(picker).toHaveBeenCalledTimes(1);

    act(() => container.querySelector<HTMLElement>("[role=button]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(picker).toHaveBeenCalledTimes(2);
  });

  it("uploads dropped files and shows the active drop state", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<FileDropCard inputId="sample-upload" category={category} files={[]} locale="en" onUpload={onUpload} onRemove={vi.fn()} />));
    const card = container.querySelector<HTMLElement>(".upload-drop-card")!;
    const file = new File(["content"], "sample.pdf", { type: "application/pdf" });
    const files = fileList(file);
    const dragEnter = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, "dataTransfer", { value: { files, dropEffect: "none" } });
    act(() => card.dispatchEvent(dragEnter));
    expect(card.classList.contains("is-dragging")).toBe(true);

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files, dropEffect: "none" } });
    await act(async () => card.dispatchEvent(drop));
    expect(onUpload).toHaveBeenCalledWith(category, files);
    expect(card.classList.contains("is-dragging")).toBe(false);
  });

  it("keeps the selected FileList alive until an async upload settles", async () => {
    let finishUpload!: () => void;
    const uploadPending = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    const onUpload = vi.fn().mockReturnValue(uploadPending);
    act(() => root.render(<FileDropCard inputId="sample-upload" category={category} files={[]} locale="en" onUpload={onUpload} onRemove={vi.fn()} />));
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const files = fileList(new File(["content"], "sample.pdf", { type: "application/pdf" }));
    let clearCount = 0;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (value: string) => {
        if (value === "") clearCount += 1;
      },
    });

    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onUpload).toHaveBeenCalledWith(category, files);
    expect(clearCount).toBe(0);

    await act(async () => {
      finishUpload();
      await uploadPending;
    });
    expect(clearCount).toBe(1);
  });

  it("does not reopen the picker when removing an uploaded file", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<FileDropCard inputId="sample-upload" category={category} files={[asset]} locale="en" onUpload={vi.fn()} onRemove={onRemove} />));
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const picker = vi.spyOn(input, "click").mockImplementation(() => undefined);

    act(() => container.querySelector<HTMLButtonElement>(".uploaded-files button")!.click());
    expect(onRemove).toHaveBeenCalledWith(asset.id);
    expect(picker).not.toHaveBeenCalled();
  });

  it.each(["picker", "camera", "drop"])("prepares cover photos from the %s entrance", async entrance => {
    const cover = { ...category, accept: ["image/jpeg"] };
    const original = new File(["original"], "camera.heic", { type: "image/heic" });
    const prepared = new File(["compressed"], "camera.jpg", { type: "image/jpeg" });
    vi.mocked(preparePhoto).mockResolvedValue(prepared);
    const onUpload = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<FileDropCard camera inputId="cover" category={cover} files={[]} locale="en" onUpload={onUpload} onRemove={vi.fn()} />));
    await act(async () => {
      if (entrance === "drop") {
        const event = new Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: { files: fileList(original) } });
        container.querySelector(".upload-drop-card")!.dispatchEvent(event);
      } else {
        const input = container.querySelectorAll<HTMLInputElement>("input[type=file]")[entrance === "camera" ? 1 : 0];
        Object.defineProperty(input, "files", { value: fileList(original) });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(preparePhoto).toHaveBeenCalledWith(original, cover);
    expect(onUpload).toHaveBeenCalledWith(cover, [prepared]);
  });
});
