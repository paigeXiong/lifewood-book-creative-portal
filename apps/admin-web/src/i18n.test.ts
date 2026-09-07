import { describe, expect, it } from "vitest";
import { i18n } from "@lifewood/i18n";
import "./i18n";

function flatten(value: Record<string, unknown>, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof entry === "string" ? [[path, entry]] : entry && typeof entry === "object" ? Object.entries(flatten(entry as Record<string, unknown>, path)) : [];
  }));
}
const sourceFiles = import.meta.glob<string>(["./**/*.{ts,tsx}", "../../task-entry-web/src/**/*.{ts,tsx}", "!**/*.test.*"], { query: "?raw", import: "default", eager: true });

const requiredKeys = [
  "creative.fields.characterName", "creative.fields.storyRole", "creative.fields.personality", "creative.fields.appearance", "creative.fields.clothing", "creative.fields.emotion", "creative.fields.voiceHint",
  "admin.presets.title", "admin.presets.imageInvalid", "admin.presets.limit",
  "admin.nav.home",
  "admin.workflow.new",
  "admin.workflow.contacting",
  "admin.workflow.completed",
  "admin.priority.urgent",
  "admin.roles.customer",
  "admin.projects.statusFilter",
  "admin.users.roleFilter",
  "admin.users.organization",
  "admin.nav.organizations",
  "admin.organizations.create",
  "admin.organizations.deactivateConfirm",
  "errors.admin.organizationExists",
  "errors.admin.organizationNotFound",
  "admin.delivery.title",
  "admin.delivery.draftHint",
  "errors.delivery.file",
  "errors.delivery.activeExists",
  "errors.project.notSubmitted",
  "errors.admin.emailExists",
  "errors.admin.selfDeactivate",
  "errors.admin.userNotFound",
  "errors.admin.ownerProtected",
  "admin.nav.settings",
  "admin.voices.title",
  "admin.voices.create",
  "admin.voices.descriptionEn",
  "admin.settings.sections",
  "admin.settings.formOptions",
  "admin.settings.fileCategories",
  "admin.fileCategories.scopes.source",
  "admin.fileCategories.accept",
  "admin.formOptions.groups.brands",
  "admin.formOptions.groups.publishing-platforms",
  "admin.formOptions.groups.visual-styles",
  "admin.formOptions.groups.voice-emotions",
  "admin.formOptions.previewColor",
  "admin.formOptions.previewImageUrl",
  "admin.formOptions.previewVideoUrl",
  "admin.formOptions.createTitle",
  "admin.account.openAvatarEditor",
  "admin.account.avatarEditorTitle",
  "admin.account.avatarCropInstruction",
  "admin.account.saveAvatar",
  "admin.account.avatarSourceInvalid",
  "creative.fields.roleType",
  "creative.fields.visualStyle",
  "voice.fields.narrationTone",
  "voice.fields.coreMessage",
];

describe("administrator locale resources", () => {
  it("has matching keys and interpolation parameters in both languages", () => {
    const zh = flatten(i18n.getResourceBundle("zh-CN", "translation"));
    const en = flatten(i18n.getResourceBundle("en-US", "translation"));
    const baseKey = (key: string) => key.replace(/_(?:zero|one|two|few|many|other)$/, "");
    expect([...new Set(Object.keys(zh).map(baseKey))].sort()).toEqual([...new Set(Object.keys(en).map(baseKey))].sort());
    const params = (value: string) => [...value.matchAll(/{{\s*([^},]+)(?:,[^}]+)?}}/g)].map(match => match[1].trim()).sort();
    for (const key of Object.keys(zh)) {
      expect(en[key].trim(), key).not.toBe("");
      expect(params(zh[key]), key).toEqual(params(en[key]));
    }
    for (const key of Object.keys(en)) expect(params(en[key]), key).toEqual(params(zh[key] ?? zh[baseKey(key)]));
  });
  it("translates dynamic photo failures and reference-image counts", () => {
    for (const locale of ["zh-CN", "en-US"]) {
      for (const key of ["photoFormat", "photoSize", "photoUnreadable", "photoTimeout", "photoUploadFailed", "photoInterrupted_camera", "photoInterrupted_processing", "photoInterrupted_uploading"]) {
        expect(i18n.getResource(locale, "translation", `bookIntake.${key}`), `${locale}: ${key}`).toBeTypeOf("string");
      }
    }
    expect(i18n.t("creative.referenceAdded", { lng: "en-US", count: 1 })).toBe("1 reference image added");
    expect(i18n.t("creative.referenceAdded", { lng: "en-US", count: 2 })).toBe("2 reference images added");
    expect(i18n.t("creative.referenceAdded", { lng: "zh-CN", count: 2 })).toBe("已添加 2 张参考图片");
  });
  it("resolves literal translation keys used by both frontends without fallback", () => {
    const missing: string[] = [];
    expect(Object.keys(sourceFiles).length).toBeGreaterThan(50);
    for (const [file, source] of Object.entries(sourceFiles)) {
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']\s*(?=[,)])/g)) {
        for (const locale of ["zh-CN", "en-US"]) {
          if (typeof i18n.getResource(locale, "translation", match[1]) !== "string") missing.push(`${file}: ${locale}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`contains required ${locale} strings`, () => {
      for (const key of requiredKeys) expect(i18n.getResource(locale, "translation", key), key).toBeTypeOf("string");
    });
  }
});
