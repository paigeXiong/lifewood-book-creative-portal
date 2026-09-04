import { describe, expect, it } from "vitest";
import {
  createReferencesStepSchema,
  createVoiceDraftSchema,
  createVoicePreferencesStepSchema,
  createVoiceStepSchema,
  isReferencesStepComplete,
  isVoicePreferencesComplete,
  isVoiceStepComplete,
} from "./pages/voiceFormSchema";

const t = (key: string) => key;
const empty = { projectName: "Project", videoGoalId: "awareness", audienceIds: ["adults"], narrationEnabled: null, contentLanguageId: "", narrationToneId: "", speechRateId: "", pronunciationNotes: "", voiceGenderId: "", voiceAgeId: "", accentId: "", emotionStyleId: "", selectedVoiceIds: [], preferredVoiceId: "", customVoiceDescription: "", assets: [], competitorUrls: [], coreMessage: "", requiredScenes: "", authorPreferences: "", closingMessage: "", musicMood: "", avoidContent: "" };

describe("voice and references validation", () => {
  it("requires project basics in references, but not in narration", () => {
    const value={...empty,projectName:"",videoGoalId:"",audienceIds:[],narrationEnabled:false,coreMessage:"Message"};
    expect(createVoicePreferencesStepSchema(t).safeParse(value).success).toBe(true);
    const parsed=createReferencesStepSchema(t).safeParse(value);
    expect(parsed.success).toBe(false);
    if(!parsed.success) expect(parsed.error.issues.map(issue=>issue.path[0])).toEqual(expect.arrayContaining(["videoGoalId","audienceIds"]));
    expect(createReferencesStepSchema(t).safeParse({...empty, projectName:"", coreMessage:"Message"}).success).toBe(true);
  });
  it("allows an incomplete draft", () => expect(createVoiceDraftSchema(t).safeParse(empty).success).toBe(true));
  it("requires language, tone, rate, and core message before review", () => {
    const result = createVoiceStepSchema(t).safeParse({ ...empty, narrationEnabled: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(["contentLanguageId", "narrationToneId", "speechRateId", "coreMessage"]));
  });
  it("validates reference URLs and preferred voice membership", () => {
    const result = createVoiceStepSchema(t).safeParse({ ...empty, narrationEnabled: true, contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium", coreMessage: "Choose courage.", competitorUrls: ["invalid"], preferredVoiceId: "voice-a" });
    expect(result.success).toBe(false);
  });
  it("validates voice preferences and references as independent workflow domains", () => {
    const voiceOnly = { ...empty, narrationEnabled: true, contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium" };
    const referencesOnly = { ...empty, coreMessage: "Choose courage." };
    expect(createVoicePreferencesStepSchema(t).safeParse(voiceOnly).success).toBe(true);
    expect(createVoicePreferencesStepSchema(t).safeParse(referencesOnly).success).toBe(false);
    expect(createReferencesStepSchema(t).safeParse(referencesOnly).success).toBe(true);
    expect(createReferencesStepSchema(t).safeParse(voiceOnly).success).toBe(false);
  });
  it("requires an explicit choice but accepts no narration without voice settings", () => {
    expect(createVoicePreferencesStepSchema(t).safeParse(empty).success).toBe(false);
    expect(createVoicePreferencesStepSchema(t).safeParse({ ...empty, narrationEnabled: false }).success).toBe(true);
    expect(createVoiceStepSchema(t).safeParse({ ...empty, narrationEnabled: false, coreMessage: "Direction" }).success).toBe(true);
    expect(createVoiceStepSchema(t).safeParse({ ...empty, narrationEnabled: false, competitorUrls: ["bad"], coreMessage: "Direction" }).success).toBe(false);
    expect(createVoiceStepSchema(t).safeParse({ ...empty, narrationEnabled: false }).success).toBe(false);
    expect(isVoicePreferencesComplete({ voiceover: { narrationEnabled: false, selectedVoiceIds: [] }, assets: [], competitorUrls: [], creativeDirection: { coreMessage: "" } })).toBe(true);
  });
  it("ignores hidden narration-only field limits after opting out", () => {
    const values = { ...empty, narrationEnabled: false, pronunciationNotes: "x".repeat(201), customVoiceDescription: "x".repeat(301) };
    expect(createVoicePreferencesStepSchema(t).safeParse(values).success).toBe(true);
    expect(createVoiceDraftSchema(t).safeParse({ ...values, narrationEnabled: true }).success).toBe(false);
  });
  it("shares the completion rule with the review route", () => {
    const complete = { voiceover: { contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium", selectedVoiceIds: [] }, assets: [], competitorUrls: [], creativeDirection: { coreMessage: "Choose courage." } };
    expect(isVoicePreferencesComplete(complete)).toBe(true);
    expect(isReferencesStepComplete(complete)).toBe(true);
    expect(isVoiceStepComplete(complete)).toBe(true);
  });
});
