import { z } from "zod";
import type { VoiceAndReferencesInfo } from "@lifewood/domain";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const assetSchema = z.object({
  id: z.string().min(1), categoryId: z.string().min(1), fileName: z.string().min(1),
  contentType: z.string().min(1), sizeBytes: z.number().positive(), url: z.string().min(1),
});

export function createVoiceDraftSchema(t: Translate) {
  const max = (value: number) => t("wizard.validation.max", { max: value });
  return z.object({
    contentLanguageId: z.string(), narrationToneId: z.string(), speechRateId: z.string(),
    pronunciationNotes: z.string().max(200, max(200)), voiceGenderId: z.string(), voiceAgeId: z.string(),
    accentId: z.string(), emotionStyleId: z.string(), selectedVoiceIds: z.array(z.string()),
    preferredVoiceId: z.string(), customVoiceDescription: z.string().max(300, max(300)),
    assets: z.array(assetSchema).max(38), competitorUrls: z.array(z.string().max(500)).max(5),
    coreMessage: z.string().max(300, max(300)), requiredScenes: z.string().max(300, max(300)),
    authorPreferences: z.string().max(300, max(300)), closingMessage: z.string().max(300, max(300)),
    musicMood: z.string().max(200, max(200)), avoidContent: z.string().max(200, max(200)),
  });
}

export function createVoiceStepSchema(t: Translate) {
  return createVoiceDraftSchema(t).superRefine((value, context) => {
    const required: Array<[keyof VoiceFormValues, string]> = [
      ["contentLanguageId", t("voice.fields.contentLanguage")], ["narrationToneId", t("voice.fields.narrationTone")],
      ["speechRateId", t("voice.fields.speechRate")], ["coreMessage", t("voice.fields.coreMessage")],
    ];
    for (const [field, label] of required) if (!String(value[field]).trim()) context.addIssue({ code: "custom", path: [field], message: t("wizard.validation.required", { field: label }) });
    value.competitorUrls.forEach((url, index) => {
      if (!url.trim()) return;
      try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); }
      catch { context.addIssue({ code: "custom", path: ["competitorUrls", index], message: t("voice.validation.url") }); }
    });
    if (value.preferredVoiceId && !value.selectedVoiceIds.includes(value.preferredVoiceId)) context.addIssue({ code: "custom", path: ["preferredVoiceId"], message: t("voice.validation.preferred") });
  });
}

export type VoiceFormValues = z.infer<ReturnType<typeof createVoiceDraftSchema>>;

export function isVoiceStepComplete(value: VoiceAndReferencesInfo): boolean {
  return Boolean(value.voiceover.contentLanguageId?.trim() && value.voiceover.narrationToneId?.trim() && value.voiceover.speechRateId?.trim() && value.creativeDirection.coreMessage.trim());
}
