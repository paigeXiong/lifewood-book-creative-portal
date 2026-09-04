import type { TaskDraft } from "@lifewood/domain";
import { isCharactersComplete, isStyleComplete } from "./pages/creativeFormSchema";
import { isProjectStepComplete, isProjectBasicsComplete } from "./pages/projectFormSchema";
import { isReferencesStepComplete, isVoicePreferencesComplete } from "./pages/voiceFormSchema";

export const workflowStepCount = 6;

export function getHighestReachableStep(draft: TaskDraft): number {
  if (!isProjectStepComplete(draft)) return 1;
  if (!isCharactersComplete(draft.creative)) return 2;
  if (!isVoicePreferencesComplete(draft.voiceAndReferences)) return 3;
  if (!isStyleComplete(draft.creative)) return 4;
  if (!isProjectBasicsComplete(draft.project) || !isReferencesStepComplete(draft.voiceAndReferences)) return 5;
  return 6;
}
