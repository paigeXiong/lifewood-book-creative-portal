import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseFormReturn } from "react-hook-form";
import { localizedApiError, projectService } from "@lifewood/api-client";
import type { BookRecognition as RecognizedBook, ReferenceAsset, SupportedLocale } from "@lifewood/domain";
import type { ProjectFormValues } from "../pages/projectFormSchema";
import { recognizedFields, recognitionUpdates } from "../book-recognition";

export function BookRecognition({ taskId, locale, enabled, assets, form, busy }: {
  taskId: string; locale: SupportedLocale; enabled: boolean; assets: ReferenceAsset[]; form: UseFormReturn<ProjectFormValues>; busy: boolean;
}) {
  const { t } = useTranslation();
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const covers = assets.filter(asset => asset.categoryId === "book-cover");
  const assetKey = covers.map(asset => asset.id).join(",");
  useEffect(() => {
    setPending(false); setMessage(""); setError("");
    return () => { controller.current?.abort(); controller.current = null; };
  }, [taskId, locale, enabled, assetKey]);
  const recognize = async () => {
    if (!enabled || pending || controller.current || busy || !covers.length) return;
    const active = new AbortController(); controller.current = active;
    const snapshot = { ...form.getValues() } satisfies RecognizedBook;
    setPending(true); setMessage(""); setError("");
    try {
      const result = await projectService.recognizeBook(taskId, covers.map(asset => asset.id), locale, active.signal);
      if (active.signal.aborted) return;
      const current = { ...form.getValues() } satisfies RecognizedBook;
      const updates = recognitionUpdates(result, snapshot, current);
      recognizedFields.forEach(key => { if (updates[key]) form.setValue(key, updates[key], { shouldDirty: true, shouldValidate: true }); });
      setMessage(t(Object.keys(updates).length ? "bookIntake.recognitionDone" : "bookIntake.recognitionNoChange"));
    } catch (reason) {
      if (!active.signal.aborted) setError(localizedApiError(reason, t));
    } finally {
      if (controller.current === active) { controller.current = null; setPending(false); }
    }
  };
  if (!enabled) return null;
  return <div className="book-recognition">
    <strong className="book-recognition-title">{t("bookIntake.recognitionTitle")}</strong>
    <div className="book-recognition-actions">
      {covers.length === 0
        ? <a className="button button-secondary" href="#source-upload-book-cover">{t("bookIntake.uploadCover")}</a>
        : <button className="button button-secondary" type="button" disabled={pending || busy} onClick={() => void recognize()}>{t(pending ? "bookIntake.recognizing" : "bookIntake.recognizeShort")}</button>}
      {pending && <button className="button button-quiet" type="button" onClick={() => { controller.current?.abort(); controller.current = null; setPending(false); }}>{t("common.cancel")}</button>}
    </div>
    {message && <p role="status">{message}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
