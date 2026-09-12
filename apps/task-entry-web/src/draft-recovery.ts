import type { FormOptions } from "@lifewood/domain";
import type { TFunction } from "i18next";

export type RecoveryValues = Record<string, unknown>;
export type RecoveryField = { path: (string | number)[]; field: string; local: unknown; latest: unknown; character?: string; recoverable: boolean };
const labels: Record<string, string> = {
  clientName: "wizard.fields.clientName", contactName: "wizard.fields.contactName", email: "wizard.fields.email", phone: "wizard.fields.phone",
  brandId: "wizard.fields.brand", projectName: "wizard.fields.projectName", videoGoalId: "wizard.fields.videoGoal", deadline: "wizard.fields.deadline", audienceIds: "wizard.fields.audiences",
  title: "wizard.fields.bookTitle", subtitle: "wizard.fields.subtitle", authorName: "wizard.fields.authorName", genreId: "wizard.fields.genre", sellingPoint: "wizard.fields.sellingPoint", synopsis: "wizard.fields.synopsis",
  contentLanguageId: "wizard.fields.contentLanguage", videoDurationId: "wizard.fields.duration", customVideoDuration: "wizard.fields.duration", publishingPlatformIds: "wizard.fields.platforms",
  roleTypeId: "creative.fields.roleType", name: "creative.fields.characterName", storyRole: "creative.fields.storyRole", personality: "creative.fields.personality", appearance: "creative.fields.appearance", ageRangeId: "creative.fields.ageRange", genderId: "creative.fields.gender", clothing: "creative.fields.clothing", emotion: "creative.fields.emotion", voiceHint: "creative.fields.voiceHint",
  visualStyleId: "creative.fields.visualStyle", moodTagIds: "creative.fields.moodTags", imageStyleTagIds: "creative.fields.imageTags", paceTagIds: "creative.fields.paceTags",
  narrationEnabled: "saveRecovery.narration", narrationToneId: "voice.fields.narrationTone", speechRateId: "voice.fields.speechRate", pronunciationNotes: "voice.fields.pronunciationNotes", voiceGenderId: "voice.fields.voiceGender", voiceAgeId: "voice.fields.voiceAge", accentId: "voice.fields.accent", emotionStyleId: "voice.fields.emotionStyle",
  selectedVoiceIds: "saveRecovery.voices", preferredVoiceId: "saveRecovery.preferredVoice", customVoiceDescription: "voice.fields.customVoice", competitorUrls: "voice.fields.competitorLinks", coreMessage: "voice.fields.coreMessage", requiredScenes: "voice.fields.requiredScenes", authorPreferences: "voice.fields.authorPreferences", closingMessage: "voice.fields.closingMessage", musicMood: "voice.fields.musicMood", avoidContent: "voice.fields.avoidContent",
};
const catalogs: Record<string, keyof FormOptions> = {
  brandId: "brands", videoGoalId: "videoGoals", audienceIds: "audiences", genreId: "genres", contentLanguageId: "contentLanguages", videoDurationId: "videoDurations", publishingPlatformIds: "publishingPlatforms",
  roleTypeId: "roleTypes", ageRangeId: "ageRanges", genderId: "genders", visualStyleId: "visualStyles", moodTagIds: "moodTags", imageStyleTagIds: "imageStyleTags", paceTagIds: "paceTags", narrationToneId: "narrationTones", speechRateId: "speechRates", voiceGenderId: "voiceGenders", voiceAgeId: "voiceAges", accentId: "accents", emotionStyleId: "voiceEmotions",
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
// Only known editable fields are recoverable. Attachments, preset URLs and identifiers never become patches.
export function recoveryFields(local: RecoveryValues, latest: RecoveryValues): RecoveryField[] {
  const rows: RecoveryField[] = [];
  const add = (a: RecoveryValues, b: RecoveryValues, prefix: (string | number)[] = [], character?: string, recoverable = true) => {
    for (const field of Object.keys(labels)) {
      if (!(field in a) && !(field in b)) continue;
      if (!equal(a[field], b[field])) rows.push({ path: [...prefix, field], field, local: a[field], latest: b[field], character, recoverable });
    }
  };
  add(local, latest);
  const before = (local.characters ?? []) as RecoveryValues[];
  const after = (latest.characters ?? []) as RecoveryValues[];
  const ids = new Set([...before, ...after].map(c => c.id));
  for (const id of ids) {
    const a = before.find(c => c.id === id); const index = after.findIndex(c => c.id === id); const b = after[index];
    add(a ?? {}, b ?? {}, ["characters", index], String(a?.name || b?.name || ""), Boolean(a && b));
  }
  return rows;
}
export function recoveryLabel(row: RecoveryField, t: TFunction) {
  const label = t(labels[row.field]);
  return row.character === undefined ? label : `${row.character || t("saveRecovery.unnamedCharacter")} · ${label}`;
}
export function recoveryText(value: unknown, field: string, t: TFunction, options?: FormOptions, voices: { id: string; name: string }[] = []): string {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return t("saveRecovery.empty");
  if (typeof value === "boolean") return t(value ? "saveRecovery.yes" : "saveRecovery.no");
  if (Array.isArray(value)) return value.map(v => recoveryText(v, field, t, options, voices)).join(" / ");
  if (field.endsWith("Id") || field.endsWith("Ids")) {
    const catalog = field === "selectedVoiceIds" || field === "preferredVoiceId" ? voices.map(v => ({ id: v.id, label: v.name })) : options?.[catalogs[field]];
    const items = Array.isArray(catalog) ? catalog as { id: string; label: string }[] : [];
    return items.find(item => item.id === value)?.label
      ?? (field === "imageStyleTagIds" ? options?.legacyImageStyleTags?.find(item => item.id === value)?.label : undefined)
      ?? t("saveRecovery.unavailableOption");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : t("saveRecovery.empty");
}
