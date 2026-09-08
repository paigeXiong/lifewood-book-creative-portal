import { useEffect, useId, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export function DeleteDraftDialog({ title, returned = false, busy, error, onConfirm, onClose, fallbackFocusRef }: {
  title: string;
  returned?: boolean;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      else fallbackFocusRef.current?.focus();
    };
  }, [fallbackFocusRef]);

  return <dialog ref={dialogRef} className="delete-draft-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="delete-draft-heading">
      <span className="delete-draft-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></span>
      <h2 id={`${id}-title`}>{t(returned ? "tasks.deleteReturnedTitle" : "tasks.deleteDialogTitle")}</h2>
    </div>
    <div id={`${id}-description`}>
      <p className="delete-draft-project">{title}</p>
      <p className="delete-draft-warning">{t(returned ? "tasks.deleteReturnedDescription" : "tasks.deleteDialogDescription")}</p>
    </div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="delete-draft-actions">
      <button ref={cancelRef} className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
      <button className="button delete-draft-confirm" type="button" disabled={busy} onClick={onConfirm}>{t(busy ? "tasks.deletingDraft" : returned ? "tasks.deleteReturned" : "tasks.deleteDraft")}</button>
    </div>
  </dialog>;
}
