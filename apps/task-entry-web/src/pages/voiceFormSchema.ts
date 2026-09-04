import { z, type RefinementCtx } from "zod";
import type { VoiceAndReferencesInfo } from "@lifewood/domain";
import { getNarrationEnabled } from "@lifewood/domain";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const assetSchema = z.object({
  id: z.string().min(1), categoryId: z.string().min(1), fileName: z.string().min(1),
  contentType: z.string().min(1), sizeBytes: z.number().positive(), url: z.string().min(1),
});

export function createVoiceDraftSchema(t: Translate) {
  const max = (value: number) => t("wizard.validation.max", { max: value });
  return z.object({
    brandId: z.string().optional(), projectName: z.string().max(200, max(200)).optional(),
    videoGoalId: z.string().optional(), deadline: z.string().optional(), audienceIds: z.array(z.string()).max(30).optional(),
    narrationEnabled: z.boolean().nullable(),
    contentLanguageId: z.string(), narrationToneId: z.string(), speechRateId: z.string(),
    pronunciationNotes: z.string(), voiceGenderId: z.string(), voiceAgeId: z.string(),
    accentId: z.string(), emotionStyleId: z.string(), selectedVoiceIds: z.array(z.string()),
    preferredVoiceId: z.string(), customVoiceDescription: z.string(),
    assets: z.array(assetSchema).max(38), competitorUrls: z.array(z.string().max(500)).max(5),
    coreMessage: z.string().max(300, max(300)), requiredScenes: z.string().max(300, max(300)),
    authorPreferences: z.string().max(300, max(300)), closingMessage: z.string().max(300, max(300)),
    musicMood: z.string().max(200, max(200)), avoidContent: z.string().max(200, max(200)),
  }).superRefine((value, context) => {
    if (value.narrationEnabled !== true) return;
    for (const [field, limit] of [["pronunciationNotes", 200], ["customVoiceDescription", 300]] as const) {
      if (value[field].length > limit)
        context.addIssue({ code: "custom", path: [field], message: max(limit) });
    }
  });
}

export function createVoiceStepSchema(t: Translate) {
  return createVoiceDraftSchema(t).superRefine((value, context) => {
    addVoicePreferenceIssues(value, context, t);
    addReferenceIssues(value, context, t);
  });
}

export type VoiceFormValues = z.infer<ReturnType<typeof createVoiceDraftSchema>>;

function addVoicePreferenceIssues(value: VoiceFormValues, context: RefinementCtx, t: Translate) {
  if (value.narrationEnabled === null) {
    context.addIssue({ code: "custom", path: ["narrationEnabled"], message: t("voice.validation.narrationChoice") });
    return;
  }
  if (!value.narrationEnabled) return;
  const required: Array<[keyof VoiceFormValues, string]> = [
    ["contentLanguageId", t("voice.fields.contentLanguage")],
    ["narrationToneId", t("voice.fields.narrationTone")],
    ["speechRateId", t("voice.fields.speechRate")],
  ];
  for (const [field, label] of required)
    if (!String(value[field]).trim()) context.addIssue({ code: "custom", path: [field], message: t("wizard.validation.required", { field: label }) });
  if (value.preferredVoiceId && !value.selectedVoiceIds.includes(value.preferredVoiceId))
    context.addIssue({ code: "custom", path: ["preferredVoiceId"], message: t("voice.validation.preferred") });
}

function addReferenceIssues(value: VoiceFormValues, context: RefinementCtx, t: Translate) {
  for (const [field, label] of [["videoGoalId", "videoGoal"]] as const)
    if (!value[field]?.trim()) context.addIssue({ code: "custom", path: [field], message: t("wizard.validation.required", { field: t(`wizard.fields.${label}`) }) });
  if (!value.audienceIds?.length) context.addIssue({ code: "custom", path: ["audienceIds"], message: t("wizard.validation.chooseOne") });
  if (value.deadline) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    if (value.deadline < today) context.addIssue({code:"custom",path:["deadline"],message:t("wizard.validation.futureDate")});
  }
  if (!value.coreMessage.trim())
    context.addIssue({ code: "custom", path: ["coreMessage"], message: t("wizard.validation.required", { field: t("voice.fields.coreMessage") }) });
  value.competitorUrls.forEach((url, index) => {
    if (!url.trim()) return;
    try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); }
    catch { context.addIssue({ code: "custom", path: ["competitorUrls", index], message: t("voice.validation.url") }); }
  });
}

export function createVoicePreferencesStepSchema(t: Translate) {
  return createVoiceDraftSchema(t).superRefine((value, context) => addVoicePreferenceIssues(value, context, t));
}

export function createReferencesStepSchema(t: Translate) {
  return createVoiceDraftSchema(t).superRefine((value, context) => addReferenceIssues(value, context, t));
}

export function isVoiceStepComplete(value: VoiceAndReferencesInfo): boolean {
  return isVoicePreferencesComplete(value) && isReferencesStepComplete(value);
}

export function isVoicePreferencesComplete(value: VoiceAndReferencesInfo): boolean {
  const enabled = getNarrationEnabled(value.voiceover);
  return enabled === false || (enabled === true && Boolean(value.voiceover.contentLanguageId?.trim() && value.voiceover.narrationToneId?.trim() && value.voiceover.speechRateId?.trim()));
}

export function isReferencesStepComplete(value: VoiceAndReferencesInfo): boolean {
  return Boolean(value.creativeDirection.coreMessage.trim());
}
