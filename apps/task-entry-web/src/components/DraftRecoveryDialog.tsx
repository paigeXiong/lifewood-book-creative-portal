import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormOptions } from "@lifewood/domain";
import type { useDraftRecovery } from "../useDraftRecovery";
import { recoveryLabel, recoveryText } from "../draft-recovery";

export function DraftRecoveryDialog({ recovery, options, voices }: {
  recovery: ReturnType<typeof useDraftRecovery>; options?: FormOptions; voices?: { id: string; name: string }[];
}) {
  const { t } = useTranslation(); const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null); const cancelRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(new Set<number>()); const [copyState, setCopyState] = useState<string>();
  const comparison = recovery.comparison;
  useEffect(() => { setSelected(new Set()); setCopyState(undefined); }, [comparison]);
  useEffect(() => {
    if (!comparison) return;
    const dialog = dialogRef.current!; const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.showModal(); cancelRef.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [Boolean(comparison)]);
  if (!comparison) return null;
  const text = (value: unknown, field: string) => recoveryText(value, field, t, options, voices);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(comparison.fields.map(row => `${recoveryLabel(row, t)}\n${text(row.local, row.field)}`).join("\n\n"));
      setCopyState(t("saveRecovery.copied"));
    } catch { setCopyState(t("saveRecovery.copyFailed")); }
  };
  return <dialog ref={dialogRef} className="draft-recovery-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} aria-busy={recovery.loading}
    onCancel={event => { event.preventDefault(); recovery.close(); }}>
    <header><h2 id={`${id}-title`}>{t("saveRecovery.compareTitle")}</h2></header>
    <p id={`${id}-hint`} className="draft-recovery-hint">{t("saveRecovery.compareHint")}</p>
    {comparison.fields.some(row => !row.recoverable) && <p className="draft-recovery-hint">{t("saveRecovery.characterChanged")}</p>}
    {comparison.latest.status !== "draft" && <p role="status">{t("saveRecovery.notEditable")}</p>}
    <div className="draft-recovery-fields">
      {!comparison.fields.length && <p>{t("saveRecovery.noDifferences")}</p>}
      {comparison.fields.map((row, index) => <fieldset key={JSON.stringify(row.path) + index}>
        <legend>{recoveryLabel(row, t)}</legend>
        <div className="draft-recovery-choices">
          <label className={selected.has(index) ? "is-selected" : ""}>
            <span><input type="radio" name={`${id}-${index}`} checked={selected.has(index)} disabled={recovery.loading || !row.recoverable || comparison.latest.status !== "draft"}
              onChange={() => setSelected(previous => new Set(previous).add(index))} />{t("saveRecovery.local")}</span>
            <div className="draft-recovery-value">{text(row.local, row.field)}</div>
          </label>
          <label className={!selected.has(index) ? "is-selected" : ""}>
            <span><input type="radio" name={`${id}-${index}`} checked={!selected.has(index)} disabled={recovery.loading}
              onChange={() => setSelected(previous => { const next = new Set(previous); next.delete(index); return next; })} />{t("saveRecovery.latest")}</span>
            <div className="draft-recovery-value">{text(row.latest, row.field)}</div>
          </label>
        </div>
      </fieldset>)}
    </div>
    {recovery.error && <p className="inline-error" role="alert">{recovery.error}</p>}
    {copyState && <p role="status">{copyState}</p>}
    <footer>
      {comparison.fields.length > 0 && <button className="button button-ghost" type="button" onClick={() => void copy()}>{t("saveRecovery.copyLocal")}</button>}
      <div><button ref={cancelRef} className="button button-secondary" type="button" onClick={recovery.close}>{t("common.cancel")}</button>
      <button className="button button-primary" type="button" disabled={recovery.loading} onClick={() => void recovery.accept(selected)}>{t(recovery.loading ? "common.loading" : "saveRecovery.apply")}</button></div>
    </footer>
  </dialog>;
}
