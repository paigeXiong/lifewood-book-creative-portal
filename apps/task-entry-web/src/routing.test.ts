import { describe, expect, it } from "vitest";
import { i18n, isSupportedLocale, localizedPath } from "@lifewood/i18n";

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

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`contains avatar editor copy for ${locale}`, () => {
      for (const key of ["nav.openAvatarEditor", "nav.avatarEditorTitle", "nav.avatarCropInstruction", "nav.saveAvatar", "nav.avatarSourceInvalid"])
        expect(i18n.getResource(locale, "translation", key), key).toBeTypeOf("string");
    });
  }
});
