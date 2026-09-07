import { useTranslation } from "react-i18next";
export function SaveFeedback({ message, conflict, invalid, busy, error, onRetry, onReload }: {
  message: string; conflict: boolean; invalid: boolean; busy: boolean; error?: string; onRetry: () => void; onReload: () => void;
}) {
  const { t } = useTranslation();
  if (!message) return null;
  return <section className="save-feedback" aria-label={t("saveRecovery.title")}>
    <div role="alert"><strong>{message}</strong><p>{t(invalid ? "saveRecovery.invalidHint" : "saveRecovery.keptHint")}</p>{error && <p className="save-recovery-error">{error}</p>}</div>
    <button className="button button-secondary" type="button" disabled={busy} onClick={conflict ? onReload : onRetry}>{t(busy ? "common.loading" : conflict ? "saveRecovery.loadLatest" : invalid ? "saveRecovery.locate" : "saveRecovery.retry")}</button>
  </section>;
}
