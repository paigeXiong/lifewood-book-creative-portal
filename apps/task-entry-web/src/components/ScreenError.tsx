import { useState } from "react";
import { useTranslation } from "react-i18next";
import { localizedApiError } from "@lifewood/api-client";

export function ScreenError({ error, onRetry }: { error: unknown; onRetry: () => void | Promise<unknown> }) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await onRetry(); }
    finally { setRetrying(false); }
  };
  return <div className="screen-status" role="alert"><div className="screen-error-content"><p>{localizedApiError(error, t)}</p><button className="button button-secondary" type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? t("common.loading") : t("common.retry")}</button></div></div>;
}
