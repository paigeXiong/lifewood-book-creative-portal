import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useConfirm } from "./useConfirm";
import { showAdminToast } from "./Toast";

export function useConfigRemoval<T>(remove: (item: T) => Promise<void>, refresh: () => Promise<unknown>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const mutation = useMutation({ mutationFn: remove });
  const run = async (item: T, name: string, preset = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); mutation.reset();
    try {
      if (!await confirm(t(preset ? "admin.configRemoval.presetConfirm" : "admin.configRemoval.confirm", { name }))) return;
      try {
        await mutation.mutateAsync(item);
        showAdminToast(t("admin.configRemoval.removed"));
      } finally {
        // Refresh after errors too, so retry uses the latest optimistic version.
        await refresh();
      }
    } catch { /* Keep the translated API error visible in the page. */ }
    finally { lock.current = false; setBusy(false); }
  };
  return { run, busy, error: mutation.error, reset: mutation.reset };
}
