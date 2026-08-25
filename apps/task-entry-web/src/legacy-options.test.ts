import { describe, expect, it } from "vitest";
import { mergeLegacyOptions } from "./legacy-options";
import { effectiveVoiceContentLanguage } from "./voice-content-language";
import { mergeLegacyCategories } from "./legacy-categories";

describe("legacy configurable options", () => {
  it("keeps a stored disabled value visible without duplicating enabled values", () => {
    const result = mergeLegacyOptions(
      [{ id: "fiction", label: "Fiction" }],
      ["fiction", "memoir", "memoir"],
      "No longer available",
    );

    expect(result).toEqual([
      { id: "fiction", label: "Fiction" },
      { id: "memoir", label: "No longer available · memoir", unavailable: true },
    ]);
  });


  it("uses the inherited book language when voice language is unset", () => {
    expect(effectiveVoiceContentLanguage(undefined, "zh-CN")).toBe("zh-CN");
    expect(effectiveVoiceContentLanguage("en-US", "zh-CN")).toBe("en-US");
  });


  it("keeps disabled file categories visible without allowing another upload", () => {
    const assets = [{ id: "asset", categoryId: "retired", fileName: "old.pdf", contentType: "application/pdf", sizeBytes: 1234, url: "/old" }];
    const merged = mergeLegacyCategories([], assets, "No longer available");
    expect(merged[0]).toMatchObject({ id: "retired", unavailable: true, maxFiles: 1 });
  });
});
