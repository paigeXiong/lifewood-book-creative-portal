import { describe, expect, it } from "vitest";
import { createVoiceDraftSchema, createVoiceStepSchema, isVoiceStepComplete } from "./pages/voiceFormSchema";

const t = (key: string) => key;
const empty = { contentLanguageId: "", narrationToneId: "", speechRateId: "", pronunciationNotes: "", voiceGenderId: "", voiceAgeId: "", accentId: "", emotionStyleId: "", selectedVoiceIds: [], preferredVoiceId: "", customVoiceDescription: "", assets: [], competitorUrls: [], coreMessage: "", requiredScenes: "", authorPreferences: "", closingMessage: "", musicMood: "", avoidContent: "" };

describe("voice and references validation", () => {
  it("allows an incomplete draft", () => expect(createVoiceDraftSchema(t).safeParse(empty).success).toBe(true));
  it("requires language, tone, rate, and core message before review", () => {
    const result = createVoiceStepSchema(t).safeParse(empty);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(["contentLanguageId", "narrationToneId", "speechRateId", "coreMessage"]));
  });
  it("validates reference URLs and preferred voice membership", () => {
    const result = createVoiceStepSchema(t).safeParse({ ...empty, contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium", coreMessage: "Choose courage.", competitorUrls: ["invalid"], preferredVoiceId: "voice-a" });
    expect(result.success).toBe(false);
  });
  it("shares the completion rule with the review route", () => {
    expect(isVoiceStepComplete({ voiceover: { contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium", selectedVoiceIds: [] }, assets: [], competitorUrls: [], creativeDirection: { coreMessage: "Choose courage." } })).toBe(true);
  });
});
