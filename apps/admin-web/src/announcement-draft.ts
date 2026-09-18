import type { AnnouncementInput } from "@lifewood/domain";

export type NoticeEditor = { scheduleAfterSave?: boolean; id: string; flowId: string; userId: string; listSearch?: string; saveConflict?: boolean; content: AnnouncementInput; organizations: Record<string,string> };
type Selection = { ids: string[]; names: Record<string,string> };
const closed = new Set<string>();
const drafts = new Map<string,NoticeEditor>();
const record = (value: unknown): value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length<=200 && value.every(item=>typeof item==="string" && item.length>0 && item.length<=200) && new Set(value).size===value.length;
const names = (value: unknown): value is Record<string,string> => record(value) && Object.values(value).every(item=>typeof item==="string");
const key = (editor: Pick<NoticeEditor,"userId"|"flowId">) => `lw.announcement.closed:${editor.userId}:${editor.flowId}`;
const draftKey = (editor: Pick<NoticeEditor,"userId"|"flowId">) => `lw.announcement.draft:${editor.userId}:${editor.flowId}`;
export function writeNoticeDraft(editor: NoticeEditor) {
  drafts.set(draftKey(editor),editor);
  try { sessionStorage.setItem(draftKey(editor),JSON.stringify(editor)); } catch { /* Keep edits in memory when tab storage is unavailable. */ }
}
export function closeNoticeDraft(editor: NoticeEditor) {
  const id=key(editor);closed.add(id);
  drafts.delete(draftKey(editor));
  try { sessionStorage.removeItem(draftKey(editor)); } catch { /* The closed marker still takes precedence. */ }
  try { sessionStorage.setItem(id,"1"); } catch { /* Retain the in-memory closed marker. */ }
}
export function readNoticeDraft(state: unknown, userId: string, restore = true): NoticeEditor | undefined {
  if(!record(state)||!record(state.announcementEditor))return;
  const draft=state.announcementEditor,content=draft.content;
  if(draft.userId!==userId || typeof draft.id!=="string" || !/^[a-zA-Z0-9-]{1,64}$/.test(draft.id) || typeof draft.flowId!=="string" || !/^[a-zA-Z0-9-]{1,64}$/.test(draft.flowId) || !names(draft.organizations) || !record(content))return;
  if(!["login","personal","banner"].includes(String(content.placement)) || !["all","specified"].includes(String(content.audience)) || !ids(content.organizationIds) || !Array.isArray(content.languages) || !content.languages.every(value=>value==="zh-CN"||value==="en-US") || !Number.isSafeInteger(content.version) || Number(content.version)<0)return;
  if(["title","body","titleZh","bodyZh","titleEn","bodyEn"].some(field=>content[field]!=null && typeof content[field]!=="string"))return;
  const editor=draft as unknown as NoticeEditor;
  if(closed.has(key(editor)))return;
  try { if(sessionStorage.getItem(key(editor))==="1")return; } catch { /* History still works when storage is unavailable. */ }
  if(restore) {
    let saved:unknown=drafts.get(draftKey(editor));
    if(!saved)try { saved=JSON.parse(sessionStorage.getItem(draftKey(editor))??"null"); } catch { /* Ignore malformed or unavailable storage. */ }
    const latest=readNoticeDraft({announcementEditor:saved},userId,false);
    if(latest?.flowId===editor.flowId && latest.id===editor.id)return latest;
  }
  return editor;
}
export function readNoticeSelection(state: unknown, editor: NoticeEditor): Selection {
  const value=record(state)?state.announcementSelection:undefined;
  return record(value) && ids(value.ids) && names(value.names)
    ? {ids:value.ids,names:value.names}
    : {ids:editor.content.organizationIds,names:editor.organizations};
}
