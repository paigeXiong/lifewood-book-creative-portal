import { describe, expect, it } from "vitest";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";

describe("localized routing", () => {
  it("accepts only configured locales", () => {
    expect(isSupportedLocale("zh-CN")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("en-GB")).toBe(false);
  });

  it("builds locale-prefixed paths consistently", () => {
    expect(localizedPath("zh-CN", "/tasks/42/edit/project")).toBe("/zh-CN/tasks/42/edit/project");
    expect(localizedPath("en-US", "tasks")).toBe("/en-US/tasks");
  });
});

