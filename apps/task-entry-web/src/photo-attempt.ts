export type PhotoStage = "camera" | "processing" | "uploading";
const key = (id: string) => `photo-attempt:${location.pathname}:${id}`;

// Only stages/timestamps are stored; never persist photos or their contents.
export function markPhotoAttempt(id: string, stage?: PhotoStage) {
  try {
    if (!stage) sessionStorage.removeItem(key(id));
    else sessionStorage.setItem(key(id), JSON.stringify({ stage, document: performance.timeOrigin, at: Date.now() }));
  } catch { /* Storage may be disabled in private browsing. */ }
}

export function interruptedPhotoAttempt(id: string): PhotoStage | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(id)) ?? "null");
    if (value && value.document !== performance.timeOrigin && Date.now() - value.at < 30 * 60_000
      && ["camera", "processing", "uploading"].includes(value.stage)) return value.stage;
  } catch { /* Invalid or unavailable storage must not block uploads. */ }
}
