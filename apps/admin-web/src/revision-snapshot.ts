import type { AdminFormOption, AdminVoiceReference, SupportedLocale, TaskDraft } from "@lifewood/domain";

type SnapshotFields = Pick<TaskDraft, "project" | "book" | "creative" | "voiceAndReferences">;
interface SnapshotConfiguration {
  formOptions: AdminFormOption[];
  voices: AdminVoiceReference[];
}

export function readRevisionSnapshot(json: string, locale: SupportedLocale) {
  const { project, book, creative, voiceAndReferences, configuration } = JSON.parse(json) as SnapshotFields & {
    configuration?: SnapshotConfiguration | null;
  };
  const optionMaps = new Map<string, Map<string, string>>();
  for (const option of configuration?.formOptions ?? []) {
    const groupId = option.groupId.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const group = optionMaps.get(groupId) ?? new Map<string, string>();
    group.set(option.id, locale === "en-US" ? option.labelEnUs : option.labelZhCn);
    optionMaps.set(groupId, group);
  }
  const voiceNames = new Map((configuration?.voices ?? []).map(voice => [
    voice.id, locale === "en-US" ? voice.nameEnUs : voice.nameZhCn,
  ]));
  // Legacy records have no saved labels. Never substitute today's configuration.
  return { fields: { project, book, creative, voiceAndReferences }, optionMaps, voiceNames };
}
