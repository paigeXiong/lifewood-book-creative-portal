import { describe, expect, it } from "vitest";
import { preserveEditableSelection, resolveEditableOption } from "./components/EditableSelect";

const options = [
  { id: "30s", label: "30 秒" },
  { id: "custom-duration", label: "自定义", allowsCustomValue: true },
];

describe("editable select", () => {
  it("stores the configured id when a listed label is chosen", () => {
    expect(resolveEditableOption("30 秒", options)).toEqual({ optionId: "30s", customValue: "" });
  });

  it("stores typed text through the server-configured custom option", () => {
    expect(resolveEditableOption("45 秒", options)).toEqual({ optionId: "custom-duration", customValue: "45 秒" });
  });

  it("does not invent a custom value when the server disallows it", () => {
    expect(resolveEditableOption("45 秒", options.slice(0, 1))).toEqual({ optionId: "", customValue: "" });
  });

  it("keeps an existing custom draft editable after the option is disabled", () => {
    const restored = preserveEditableSelection([{ id: "custom-duration", label: "自定义（已停用）", unavailable: true }], "custom-duration", "45 秒");
    expect(restored[0]).toMatchObject({ allowsCustomValue: true, unavailable: false });
    expect(resolveEditableOption("50 秒", restored)).toEqual({ optionId: "custom-duration", customValue: "50 秒" });
  });
});
