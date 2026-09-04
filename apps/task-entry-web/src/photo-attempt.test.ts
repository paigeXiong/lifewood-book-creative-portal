// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { interruptedPhotoAttempt, markPhotoAttempt } from "./photo-attempt";
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });
it("reports the last stage only after a new document loads", () => {
  vi.stubGlobal("performance", { timeOrigin: 1 });
  markPhotoAttempt("cover", "camera");
  expect(interruptedPhotoAttempt("cover")).toBeUndefined();
  markPhotoAttempt("cover", "processing");
  vi.stubGlobal("performance", { timeOrigin: 2 });
  expect(interruptedPhotoAttempt("cover")).toBe("processing");
  expect(interruptedPhotoAttempt("other")).toBeUndefined();
  markPhotoAttempt("cover");
  expect(interruptedPhotoAttempt("cover")).toBeUndefined();
});
it("ignores expired attempts", () => {
  vi.stubGlobal("performance", { timeOrigin: 1 });
  markPhotoAttempt("cover", "camera");
  vi.stubGlobal("performance", { timeOrigin: 2 });
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
  expect(interruptedPhotoAttempt("cover")).toBeUndefined();
  now.mockRestore();
});
