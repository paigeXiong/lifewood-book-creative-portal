import type { TaskDraft } from "@lifewood/domain";

// Refreshing attachment state must never silently rebase local text over another editor's changes.
export function sameUploadContent(before: TaskDraft, after: TaskDraft): boolean {
  const content = (draft: TaskDraft) => ({
    id: draft.id, status: draft.status, project: draft.project,
    book: { ...draft.book, sourceAssets: undefined },
    creative: { ...draft.creative, styleReferenceImages: undefined,
      characters: draft.creative.characters.map(character => ({ ...character, referenceImages: undefined })) },
    voiceAndReferences: { ...draft.voiceAndReferences, assets: undefined },
  });
  return JSON.stringify(content(before)) === JSON.stringify(content(after));
}
