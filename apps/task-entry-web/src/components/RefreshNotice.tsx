import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@lifewood/api-client";

// Cached content may survive transient failures, never an access or account change.
export function canRetainQueryData(error: unknown): boolean {
  return error instanceof ApiError && !error.details.code.startsWith("auth.") && error.details.retryable === true;
}

export function RefreshNotice({ error, onRetry }: { error: unknown; onRetry: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  if (!error) return null;
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };
  return <div className="inline-error" role="alert"><span>{t("recovery.refreshFailed")}</span> <button type="button" className="button button-secondary" disabled={retrying} onClick={() => void retry()}>{t(retrying ? "common.loading" : "common.retry")}</button></div>;
}
