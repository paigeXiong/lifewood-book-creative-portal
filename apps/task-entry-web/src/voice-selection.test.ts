import { describe, expect, it } from "vitest";
import { reconcileVoiceSelection } from "./voice-selection";

describe("reconcileVoiceSelection", () => {
  it("removes disabled selections and clears an unavailable preferred voice", () => {
    expect(reconcileVoiceSelection(["enabled", "disabled"], "disabled", ["enabled"])).toEqual({
      selectedVoiceIds: ["enabled"],
      preferredVoiceId: "",
      removedCount: 1,
    });
  });

  it("preserves enabled selections and preferred voice", () => {
    expect(reconcileVoiceSelection(["first", "second"], "second", ["first", "second"])).toEqual({
      selectedVoiceIds: ["first", "second"],
      preferredVoiceId: "second",
      removedCount: 0,
    });
  });
});
