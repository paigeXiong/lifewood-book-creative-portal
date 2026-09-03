import { describe, expect, it } from "vitest";
import { i18n } from "@lifewood/i18n";
import "./i18n";

const requiredKeys = [
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
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`contains required ${locale} strings`, () => {
      for (const key of requiredKeys) expect(i18n.getResource(locale, "translation", key), key).toBeTypeOf("string");
    });
  }
});
