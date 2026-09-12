// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceCategory } from "@lifewood/domain";
import { prepareFeedbackScreenshot } from "./prepare-feedback-screenshot";
import { preparePhoto } from "./prepare-photo";

const category: ReferenceCategory = { id: "cover", label: "Cover", accept: ["image/jpeg", "image/png"], maxBytes: 100, maxFiles: 6, allowsUrl: false, required: true };
let unreadable = false;
let sizes: number[];
let dimensions: number[][];
const revoke = vi.fn();

beforeEach(() => {
  vi.spyOn(Blob.prototype, "slice").mockReturnValue({ arrayBuffer: async () => new ArrayBuffer(0) } as Blob);
  unreadable = false;
  sizes = [20];
  dimensions = [];
  vi.stubGlobal("URL", { createObjectURL: () => "blob:photo", revokeObjectURL: revoke });
  vi.stubGlobal("Image", class {
    naturalWidth = 4000;
    naturalHeight = 3000;
    onload?: () => void;
    onerror?: () => void;
    set src(_: string) { queueMicrotask(() => unreadable ? this.onerror?.() : this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    dimensions.push([this.width, this.height]);
    callback(new Blob([new Uint8Array(sizes.shift() ?? 200)], { type }));
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); revoke.mockClear(); });

describe("camera photo preparation", () => {
  it("uploads a fitting camera JPEG without decoding or recompressing", async () => {
    vi.mocked(Blob.prototype.slice).mockReturnValue({ arrayBuffer: async () => new Uint8Array([255, 216, 255, 224]).buffer } as Blob);
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const file = new File([new Uint8Array(6_000_000)], "camera.bin", { type: "application/octet-stream" });
    const result = await preparePhoto(file, { ...category, maxBytes: 10_000_000 });
    expect(result.size).toBe(file.size);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("camera.jpg");
    expect(decode).not.toHaveBeenCalled();
    expect(dimensions).toEqual([]);
  });
  it("requests resized pixels and releases the bitmap after encoding", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 1600, height: 1200, close });
    vi.stubGlobal("createImageBitmap", decode);
    await preparePhoto(new File(["photo"], "camera.jpg"), category);
    expect(decode).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ resizeWidth: 1600, imageOrientation: "from-image" }));
    expect(dimensions).toEqual([[1600, 1200]]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("releases a bitmap that arrives after the decode timeout", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    let complete!: (value: unknown) => void;
    vi.stubGlobal("createImageBitmap", () => new Promise(resolve => { complete = resolve; }));
    const pending = expect(preparePhoto(new File(["photo"], "camera.jpg"), category)).rejects.toMatchObject({ key: "photoTimeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    complete({ width: 1600, height: 1200, close });
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });
  it("reports a stalled image decoder instead of waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", class { set src(_: string) {} });
    const pending = expect(preparePhoto(new File(["photo"], "camera.jpg"), category)).rejects.toMatchObject({ key: "photoTimeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(revoke).toHaveBeenCalled();
  });
  it("reports a stalled canvas encoder", async () => {
    vi.useFakeTimers();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => {});
    const pending = expect(preparePhoto(new File(["photo"], "camera.jpg"), category)).rejects.toMatchObject({ key: "photoTimeout" });
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;
  });
  it("re-encodes a decoded camera file with matching JPEG name and type", async () => {
    const result = await preparePhoto(new File(["photo"], "IMG_123.HEIC", { type: "image/heic" }), category);
    expect(result.name).toBe("IMG_123.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBe(20);
    expect(dimensions).toEqual([[2400, 1800]]);
    expect(revoke).toHaveBeenCalledWith("blob:photo");
  });
  it("reduces quality before dimensions when the encoded photo exceeds the target", async () => {
    sizes = [200, 50];
    const result = await preparePhoto(new File(["photo"], "camera.jpg"), category);
    expect(result.size).toBeLessThanOrEqual(category.maxBytes);
    expect(dimensions).toEqual([[2400, 1800], [2400, 1800]]);
  });
  it("reports an unreadable format and releases the photo URL", async () => {
    unreadable = true;
    await expect(preparePhoto(new File(["bad"], "camera.heic"), category)).rejects.toMatchObject({ key: "photoUnreadable" });
    expect(revoke).toHaveBeenCalled();
  });
  it("reports size failure when compression cannot satisfy the configured limit", async () => {
    sizes = [];
    await expect(preparePhoto(new File(["photo"], "camera.jpg"), category)).rejects.toMatchObject({ key: "photoSize" });
    expect(dimensions).toHaveLength(24);
  });
  it("continues compressing a 6 MB photo even though it fits the 10 MB category", async () => {
    sizes = [6_000_000, 3_000_000, 1_900_000];
    const result = await preparePhoto(new File(["photo"], "camera.jpg"), { ...category, maxBytes: 10_000_000 });
    expect(result.size).toBeLessThanOrEqual(2_000_000);
    expect(dimensions).toHaveLength(3);
  });
  it("resizes when JPEG quality alone does not meet the target", async () => {
    sizes = [200, 200, 200, 200, 50];
    await preparePhoto(new File(["photo"], "camera.jpg"), category);
    expect(dimensions[4]).toEqual([1920, 1440]);
  });
  it("resizes PNG directly since its encoder ignores JPEG quality", async () => {
    sizes = [200, 50];
    const result = await preparePhoto(new File(["photo"], "camera.png"), { ...category, accept: ["image/png"] });
    expect(dimensions).toEqual([[2400, 1800], [1920, 1440]]);
    expect(result.type).toBe("image/png");
  });
});

describe("feedback screenshot preparation", () => {
  const limits = { sourceMaxBytes: 10_000_000, storedMaxBytes: 1_000_000 };
  it("accepts a 10 MB screenshot and tries lossless encoding with legible dimensions", async () => {
    sizes = [800_000];
    const result = await prepareFeedbackScreenshot(new File([new Uint8Array(10_000_000)], "screen.png", { type: "image/png" }), limits);
    expect(result.type).toBe("image/png");
    expect(result.size).toBe(800_000);
    expect(dimensions).toEqual([[3200, 2400]]);
  });
  it("tries high-quality JPEG before reducing screenshot dimensions", async () => {
    sizes = [1_200_000, 950_000, 800_000];
    const result = await prepareFeedbackScreenshot(new File([new Uint8Array(1_100_000)], "screen.png", { type: "image/png" }), limits);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("screen.jpg");
    expect(result.size).toBeLessThanOrEqual(limits.storedMaxBytes);
    expect(dimensions).toEqual([[3200, 2400], [3200, 2400], [3200, 2400]]);
    expect(vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.calls.map(args => args.slice(1))).toEqual([["image/png"], ["image/jpeg", .92], ["image/jpeg", .86]]);
  });
  it("keeps an already-small WebP without recompression", async () => {
    vi.mocked(Blob.prototype.slice).mockReturnValue({ arrayBuffer: async () => new Uint8Array([82,73,70,70,20,0,0,0,87,69,66,80]).buffer } as Blob);
    const file = new File([new Uint8Array(32)], "screen.webp", { type: "image/webp" });
    const result = await prepareFeedbackScreenshot(file, limits);
    expect(result.type).toBe("image/webp");expect(result.size).toBe(file.size);expect(dimensions).toEqual([]);
  });
  it("rejects oversized and unsupported source files before decoding", async () => {
    await expect(prepareFeedbackScreenshot(new File([new Uint8Array(10_000_001)], "screen.png", { type: "image/png" }), limits)).rejects.toThrow("invalid_source");
    await expect(prepareFeedbackScreenshot(new File(["<svg/>"], "screen.svg", { type: "image/svg+xml" }), limits)).rejects.toThrow("invalid_source");
    expect(dimensions).toEqual([]);
  });
  it("reports a corrupt large image instead of sending the oversized original", async () => {
    unreadable = true;
    await expect(prepareFeedbackScreenshot(new File([new Uint8Array(1_100_000)], "screen.png", { type: "image/png" }), limits)).rejects.toMatchObject({ key: "photoUnreadable" });
  });
});
