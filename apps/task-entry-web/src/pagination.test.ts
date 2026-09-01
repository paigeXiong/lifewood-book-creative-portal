import { describe, expect, it } from "vitest";
import { buildPagination } from "./pagination";

describe("numbered pagination", () => {
  it("shows every page when the result is short", () => {
    expect(buildPagination(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first pages and final destination near the beginning", () => {
    expect(buildPagination(1, 10)).toEqual([1, 2, 3, 4, 5, "end-ellipsis", 10]);
  });

  it("shows nearby pages with both ellipses in the middle", () => {
    expect(buildPagination(6, 12)).toEqual([1, "start-ellipsis", 5, 6, 7, "end-ellipsis", 12]);
  });

  it("keeps the first destination and final pages near the end", () => {
    expect(buildPagination(10, 10)).toEqual([1, "start-ellipsis", 6, 7, 8, 9, 10]);
  });
});
