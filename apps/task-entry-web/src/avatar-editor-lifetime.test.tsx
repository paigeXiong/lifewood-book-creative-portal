import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvatarEditor, type AvatarEditorLabels } from "@lifewood/ui/avatar-editor";
import { i18n } from "@lifewood/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, labels: AvatarEditorLabels;
let blobs: BlobCallback[], images: FakeImage[];
const save = vi.fn(), close = vi.fn(), revoke = vi.fn();
class FakeImage {
  naturalWidth = 1024; naturalHeight = 768; src = "";
  onload?: () => void; onerror?: () => void;
  constructor() { images.push(this); }
}
beforeEach(() => {
  images = []; blobs = []; save.mockClear(); close.mockClear(); revoke.mockClear();
  vi.stubGlobal("Image", FakeImage);
  const OriginalURL = URL;
  vi.stubGlobal("URL", class extends OriginalURL { static createObjectURL = vi.fn(() => "blob:avatar-test"); static revokeObjectURL = revoke; });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => { blobs.push(callback); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale);
  labels = { title: i18n.t("nav.avatarEditorTitle"), close: i18n.t("common.close"), choose: i18n.t("nav.chooseAvatar"), chooseAnother: i18n.t("nav.chooseAnotherAvatar"), instruction: i18n.t("nav.avatarCropInstruction"), zoom: i18n.t("nav.avatarZoom"), cancel: i18n.t("common.cancel"), save: i18n.t("nav.saveAvatar"), saving: i18n.t("nav.avatarUploading"), remove: i18n.t("nav.removeAvatar"), invalidImage: i18n.t("nav.avatarSourceInvalid") };
  await render(false);
}
async function render(busy: boolean, error?: string) { await act(async () => root.render(<AvatarEditor avatarUrl="/avatar" displayName="Test" hasCustomAvatar labels={labels} busy={busy} error={error} onSave={save} onRemove={vi.fn()} onClose={close} />)); }
async function choose() {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,0,0,0,3,0]);
  const file = new File([png], "source.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => png.buffer });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => images.at(-1)!.onload?.());
}
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`exports once while the asynchronous crop is pending (${locale})`, async () => {
    await mount(locale); await choose();
    const button = host.querySelector<HTMLButtonElement>(".avatar-editor-save")!;
    await act(async () => { button.click(); button.click(); });
    expect(blobs).toHaveLength(1); expect(save).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(close).not.toHaveBeenCalled();
    await act(async () => blobs[0](new Blob(["png"], { type: "image/png" })));
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toBeInstanceOf(File);
    expect(save.mock.calls[0][0].name).toBe("avatar.png");
  });
  it(`never uploads an encoded crop after the editor unmounts (${locale})`, async () => {
    await mount(locale); await choose();
    await act(async () => host.querySelector<HTMLButtonElement>(".avatar-editor-save")!.click());
    await act(async () => root.render(<div />));
    await act(async () => blobs[0](new Blob(["png"], { type: "image/png" })));
    expect(save).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith("blob:avatar-test");
    expect(document.body.style.overflow).not.toBe("hidden");
  });
  it(`keeps the crop and allows retry after encoding or upload failure (${locale})`, async () => {
    await mount(locale); await choose();
    await act(async () => host.querySelector<HTMLButtonElement>(".avatar-editor-save")!.click());
    await act(async () => blobs[0](null));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(labels.invalidImage);
    expect(host.querySelector(".avatar-crop-stage")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".avatar-editor-save")!.click());
    await act(async () => blobs[1](new Blob(["png"], { type: "image/png" })));
    await render(true); expect(host.querySelector<HTMLButtonElement>(".avatar-editor-save")!.disabled).toBe(true);
    await render(false, i18n.t("nav.avatarFailed"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("nav.avatarFailed"));
    expect(host.querySelector(".avatar-crop-stage")).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".avatar-editor-save")!.disabled).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
}
