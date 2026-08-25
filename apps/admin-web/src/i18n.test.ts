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
  "admin.delivery.title",
  "admin.delivery.draftHint",
  "errors.delivery.file",
  "errors.project.notSubmitted",
  "errors.admin.emailExists",
  "errors.admin.selfDeactivate",
  "errors.admin.userNotFound",
  "errors.admin.ownerProtected",
  "admin.nav.settings",
  "admin.voices.title",
  "admin.voices.create",
  "admin.voices.descriptionEn",
];

describe("administrator locale resources", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`contains required ${locale} strings`, () => {
      for (const key of requiredKeys) expect(i18n.getResource(locale, "translation", key), key).toBeTypeOf("string");
    });
  }
});
