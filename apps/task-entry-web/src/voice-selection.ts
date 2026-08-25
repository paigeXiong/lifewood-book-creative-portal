export interface ReconciledVoiceSelection {
  selectedVoiceIds: string[];
  preferredVoiceId: string;
  removedCount: number;
}

export function reconcileVoiceSelection(
  selectedVoiceIds: string[],
  preferredVoiceId: string | undefined,
  enabledVoiceIds: Iterable<string>,
): ReconciledVoiceSelection {
  const enabled = new Set(enabledVoiceIds);
  const selected = selectedVoiceIds.filter((id) => enabled.has(id));
  return {
    selectedVoiceIds: selected,
    preferredVoiceId: preferredVoiceId && selected.includes(preferredVoiceId) ? preferredVoiceId : "",
    removedCount: selectedVoiceIds.length - selected.length,
  };
}
