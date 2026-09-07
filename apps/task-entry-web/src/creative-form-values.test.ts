import { describe, expect, it } from "vitest";
import type { CreativeInfo } from "@lifewood/domain";
import { toCreativeFormValues } from "./creative-form-values";
import { createCreativeDraftSchema, createStyleStepSchema, emptyCharacter } from "./pages/creativeFormSchema";

describe("creative API values", () => {
  it("retains immutable preset image snapshots including explicit empty images", () => {
    for (const presetImageUrl of ["/api/character-preset-images/snapshot.png", ""]) {
      const creative = { characters: [{ ...emptyCharacter(), presetId: "custom", presetImageUrl }], visualStyleId: "", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [], styleReferenceImages: [] } as CreativeInfo;
      expect(toCreativeFormValues(creative).characters[0].presetImageUrl).toBe(presetImageUrl);
    }
  });
  it("allows manual characters with a null preset to save and leave the style step", () => {
    const creative = {
      characters: [{ ...emptyCharacter(), id: "manual", presetId: null, name: "Manual character" }],
      visualStyleId: "cinematic", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [], styleReferenceImages: [],
    } as unknown as CreativeInfo;
    const values = toCreativeFormValues(creative);
    expect(values.characters[0].presetId).toBeUndefined();
    expect(values.characters[0].name).toBe("Manual character");
    expect(createCreativeDraftSchema(key => key).safeParse(values).success).toBe(true);
    expect(createStyleStepSchema(key => key).safeParse(values).success).toBe(true);
  });
  it("preserves actual preset identifiers", () => {
    const creative = { characters: [{ ...emptyCharacter(), presetId: "protagonist" }], visualStyleId: "", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [], styleReferenceImages: [] } as CreativeInfo;
    expect(toCreativeFormValues(creative).characters[0].presetId).toBe("protagonist");
  });
});
