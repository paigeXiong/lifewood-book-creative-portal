import { describe, expect, it } from "vitest";
import {
  createCharactersStepSchema,
  createCreativeDraftSchema,
  createCreativeStepSchema,
  createStyleStepSchema,
  emptyCharacter,
  isCharactersComplete,
  isCreativeComplete,
  isStyleComplete,
} from "./pages/creativeFormSchema";

const t = (key: string) => key;
const empty = { characters: [], visualStyleId: "", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [], styleReferenceImages: [] };

describe("creative form validation", () => {
  it("permits one color tone and preserves only pre-existing multiple selections", () => {
    const parse = (ids: string[], previous: string[] = []) => createCreativeDraftSchema(t, previous).safeParse({ ...empty, imageStyleTagIds: ids }).success;
    expect(parse(["warm-tone"])).toBe(true);
    expect(parse(["warm-tone", "cool-tone"])).toBe(false);
    expect(parse(["vintage", "modern"], ["vintage", "modern"])).toBe(true);
    expect(parse(["vintage", "warm-tone"], ["vintage", "modern"])).toBe(false);
    expect(parse(["vintage", "vintage"], ["vintage", "modern"])).toBe(false);
  });
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

  it("validates characters and visual style as independent workflow domains", () => {
    const character = { ...emptyCharacter(), roleTypeId: "protagonist", name: "Mara", storyRole: "Leads", personality: "Curious", appearance: "Traveler" };
    expect(createCharactersStepSchema(t).safeParse({ ...empty, characters: [character] }).success).toBe(true);
    expect(createCharactersStepSchema(t).safeParse({ ...empty, visualStyleId: "cinematic" }).success).toBe(false);
    expect(createStyleStepSchema(t).safeParse({ ...empty, visualStyleId: "cinematic" }).success).toBe(true);
    expect(createStyleStepSchema(t).safeParse({ ...empty, characters: [character] }).success).toBe(false);
  });

  it("accepts stored character and style reference image metadata", () => {
    const asset = { id: "file-1", categoryId: "style-reference", fileName: "style.png", contentType: "image/png", sizeBytes: 128, url: "/api/projects/p/files/file-1" };
    const character = { ...emptyCharacter(), referenceImages: [{ ...asset, categoryId: "character-reference" }] };
    expect(createCreativeDraftSchema(t).safeParse({ ...empty, characters: [character], styleReferenceImages: [asset] }).success).toBe(true);
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

  it("reports independent completion for route guards and future domain returns", () => {
    const complete = { ...emptyCharacter(), roleTypeId: "protagonist", name: "Mara", storyRole: "Leads", personality: "Curious", appearance: "Traveler" };
    expect(isCharactersComplete({ ...empty, characters: [complete] })).toBe(true);
    expect(isStyleComplete({ ...empty, visualStyleId: "cinematic" })).toBe(true);
    expect(isCharactersComplete({ ...empty, visualStyleId: "cinematic" })).toBe(false);
    expect(isStyleComplete({ ...empty, characters: [complete] })).toBe(false);
  });
});
