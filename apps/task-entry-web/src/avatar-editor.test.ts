import { describe, expect, it } from "vitest";
import { avatarImageDimensionsAreSafe, clampAvatarOffset, parseAvatarImageDimensions } from "@lifewood/ui/avatar-editor";

describe("avatar crop positioning", () => {
  it("keeps the source image covering the crop viewport", () => {
    expect(clampAvatarOffset(100, 300)).toBe(30);
    expect(clampAvatarOffset(-100, 300)).toBe(-30);
    expect(clampAvatarOffset(12, 300)).toBe(12);
    expect(clampAvatarOffset(20, 200)).toBe(0);
  });

  it("reads dimensions from supported image headers before browser decoding", () => {
    const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,0,0,0,3,0]);
    const jpeg = Uint8Array.from([0xff,0xd8,0xff,0xc0,0,7,8,3,0,4,0,0xff,0xd9]);
    const webp = Uint8Array.from([82,73,70,70,22,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    expect(parseAvatarImageDimensions(png.buffer, "image/png")).toEqual({ width: 1024, height: 768 });
    expect(parseAvatarImageDimensions(jpeg.buffer, "image/jpeg")).toEqual({ width: 1024, height: 768 });
    expect(parseAvatarImageDimensions(webp.buffer, "image/webp")).toEqual({ width: 1, height: 1 });
    expect(avatarImageDimensionsAreSafe({ width: 1024, height: 1024 })).toBe(true);
    expect(avatarImageDimensionsAreSafe({ width: 8000, height: 8000 })).toBe(false);
  });
});
