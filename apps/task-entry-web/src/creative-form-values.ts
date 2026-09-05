import type { CreativeInfo } from "@lifewood/domain";
import type { CreativeFormValues } from "./pages/creativeFormSchema";
export function toCreativeFormValues(creative: CreativeInfo): CreativeFormValues {
  return {
    characters: creative.characters.map((character) => ({
      id: character.id,
      presetId: character.presetId ?? undefined,
      roleTypeId: character.roleTypeId ?? "",
      name: character.name,
      storyRole: character.storyRole,
      personality: character.personality,
      appearance: character.appearance,
      ageRangeId: character.ageRangeId ?? "",
      genderId: character.genderId ?? "",
      clothing: character.clothing ?? "",
      emotion: character.emotion ?? "",
      voiceHint: character.voiceHint ?? "",
      referenceImageUrls: character.referenceImageUrls,
      referenceImages: character.referenceImages ?? [],
    })),
    visualStyleId: creative.visualStyleId ?? "",
    moodTagIds: creative.moodTagIds,
    imageStyleTagIds: creative.imageStyleTagIds,
    paceTagIds: creative.paceTagIds,
    styleReferenceImageUrls: creative.styleReferenceImageUrls,
    styleReferenceImages: creative.styleReferenceImages ?? [],
  };
}
