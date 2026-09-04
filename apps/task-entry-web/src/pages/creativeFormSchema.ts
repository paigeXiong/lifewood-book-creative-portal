import { createId } from "../create-id";
import { z, type RefinementCtx } from "zod";
import type { Translate } from "./projectFormSchema";
import type { CreativeInfo } from "@lifewood/domain";

export function createCreativeDraftSchema(t: Translate, previousToneIds: readonly string[] = []) {
  const text = (max: number) => z.string().max(max, t("wizard.validation.max", { max }));
  const asset = z.object({
    id: z.string().min(1), categoryId: z.string().min(1), fileName: z.string().min(1),
    contentType: z.string().min(1), sizeBytes: z.number().positive(), url: z.string().min(1),
  });
  return z.object({
    characters: z.array(z.object({
      presetId: z.string().optional(), id: z.string().min(1), roleTypeId: z.string(), name: text(80), storyRole: text(200), personality: text(300),
      appearance: text(300), ageRangeId: z.string(), genderId: z.string(), clothing: text(200), emotion: text(150),
      voiceHint: text(100), referenceImageUrls: z.array(z.string()).max(6), referenceImages: z.array(asset).max(50),
    })).max(12),
    visualStyleId: z.string(), moodTagIds: z.array(z.string()).max(6), imageStyleTagIds: z.array(z.string()).max(6).refine(
      values => new Set(values).size === values.length && (values.length <= 1 ||
        (previousToneIds.length > 1 && values.every(id => previousToneIds.includes(id)))),
      t("creative.colorTone.singleSelection"),
    ),
    paceTagIds: z.array(z.string()).max(4), styleReferenceImageUrls: z.array(z.string()).max(6), styleReferenceImages: z.array(asset).max(50),
  });
}

export function createCreativeStepSchema(t: Translate, previousToneIds: readonly string[] = []) {
  return createCreativeDraftSchema(t, previousToneIds).superRefine((values, context) => {
    addCharacterIssues(values, context, t);
    addStyleIssues(values, context, t);
  });
}

type CreativeValues = CreativeFormValues;
function addCharacterIssues(values: CreativeValues, context: RefinementCtx, t: Translate) {
    if (!values.characters.length) context.addIssue({ code: "custom", path: ["characters"], message: t("creative.validation.characterRequired") });
    values.characters.forEach((character, index) => {
      const required: Array<[keyof typeof character, string]> = [
        ["roleTypeId", "roleType"], ["name", "characterName"], ["storyRole", "storyRole"],
        ["personality", "personality"], ["appearance", "appearance"],
      ];
      required.forEach(([field, label]) => {
        if (!String(character[field]).trim()) context.addIssue({ code: "custom", path: ["characters", index, field], message: t("wizard.validation.required", { field: t(`creative.fields.${label}`) }) });
      });
    });
}

function addStyleIssues(values: CreativeValues, context: RefinementCtx, t: Translate) {
    if (!values.visualStyleId) context.addIssue({ code: "custom", path: ["visualStyleId"], message: t("creative.validation.styleRequired") });
}

export function createCharactersStepSchema(t: Translate, previousToneIds: readonly string[] = []) {
  return createCreativeDraftSchema(t, previousToneIds).superRefine((values, context) => {
    addCharacterIssues(values, context, t);
  });
}

export function createStyleStepSchema(t: Translate, previousToneIds: readonly string[] = []) {
  return createCreativeDraftSchema(t, previousToneIds).superRefine((values, context) => {
    addStyleIssues(values, context, t);
  });
}

export type CreativeFormValues = z.infer<ReturnType<typeof createCreativeDraftSchema>>;

export function isCreativeComplete(creative: CreativeInfo): boolean {
  return isCharactersComplete(creative) && isStyleComplete(creative);
}

export function isCharactersComplete(creative: CreativeInfo): boolean {
  return Boolean(creative.characters.length && creative.characters.every((character) =>
    character.roleTypeId && character.name.trim() && character.storyRole.trim() && character.personality.trim() && character.appearance.trim()));
}

export function isStyleComplete(creative: CreativeInfo): boolean {
  return Boolean(creative.visualStyleId);
}

export function emptyCharacter(): CreativeFormValues["characters"][number] {
  return { id: createId(), roleTypeId: "", name: "", storyRole: "", personality: "", appearance: "", ageRangeId: "", genderId: "", clothing: "", emotion: "", voiceHint: "", referenceImageUrls: [], referenceImages: [] };
}
