import { describe, expect, it } from "vitest";
import { createCreativeDraftSchema, createCreativeStepSchema, emptyCharacter, isCreativeComplete } from "./pages/creativeFormSchema";

const t = (key: string) => key;
const empty = { characters: [], visualStyleId: "", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [] };

describe("creative form validation", () => {
  it("allows an incomplete creative draft", () => {
    expect(createCreativeDraftSchema(t).safeParse(empty).success).toBe(true);
  });

  it("requires a completed character and primary style before continuing", () => {
    const result = createCreativeStepSchema(t).safeParse({ ...empty, characters: [emptyCharacter()] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "characters.0.name")).toBe(true);
      expect(result.error.issues.some((issue) => issue.path[0] === "visualStyleId")).toBe(true);
    }
  });

  it("accepts a complete character and configured style id shape", () => {
    const character = { ...emptyCharacter(), roleTypeId: "protagonist", name: "Mara", storyRole: "Leads the journey", personality: "Curious", appearance: "Traveler" };
    expect(createCreativeStepSchema(t).safeParse({ ...empty, characters: [character], visualStyleId: "cinematic" }).success).toBe(true);
  });

  it("keeps every added character complete before advancing", () => {
    const complete = { ...emptyCharacter(), roleTypeId: "protagonist", name: "Mara", storyRole: "Leads", personality: "Curious", appearance: "Traveler" };
    const result = createCreativeStepSchema(t).safeParse({ ...empty, characters: [complete, emptyCharacter()], visualStyleId: "cinematic" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join(".") === "characters.1.name")).toBe(true);
  });

  it("uses the same completion rule for guarded later-step routes", () => {
    const complete = { ...emptyCharacter(), roleTypeId: "protagonist", name: "Mara", storyRole: "Leads", personality: "Curious", appearance: "Traveler" };
    expect(isCreativeComplete({ ...empty, characters: [complete], visualStyleId: "cinematic" })).toBe(true);
    expect(isCreativeComplete({ ...empty, characters: [complete, emptyCharacter()], visualStyleId: "cinematic" })).toBe(false);
  });
});
