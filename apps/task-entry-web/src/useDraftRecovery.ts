import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale, TaskDraft } from "@lifewood/domain";
import { useConfirm } from "./useConfirm";

export function useDraftRecovery(taskId: string | undefined, locale: SupportedLocale, snapshot: () => string, apply: (draft: TaskDraft) => void) {
  const { t } = useTranslation(); const confirm = useConfirm();
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string>();
  const callbacks = useRef({ snapshot, apply }); callbacks.current = { snapshot, apply };
  const scope = useRef<object | null>(null); const pending = useRef<object | null>(null);
  useEffect(() => {
    scope.current = {}; pending.current = null; setLoading(false); setError(undefined);
    return () => { scope.current = null; };
  }, [taskId, locale]);
  const reload = async () => {
    if (pending.current || !taskId) return;
    const currentScope = scope.current;
    pending.current = currentScope;
    try {
      if (!await confirm(t("saveRecovery.replaceConfirm"))) return;
      if (scope.current !== currentScope) return;
      const before = callbacks.current.snapshot();
      setLoading(true); setError(undefined);
      const latest = await projectService.getProject(taskId, locale);
      if (scope.current !== currentScope) return;
      if (callbacks.current.snapshot() !== before && !await confirm(t("saveRecovery.changedWhileLoading"))) return;
      if (scope.current === currentScope) callbacks.current.apply(latest);
    } catch (cause) {
      if (scope.current === currentScope) setError(`${t("saveRecovery.reloadFailed")} ${localizedApiError(cause, t)}`);
    } finally {
      if (pending.current === currentScope) pending.current = null;
      if (scope.current === currentScope) setLoading(false);
    }
  };
  return { reload, loading, error };
}

export function focusSaveIssue(path: string) {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLElement>(`[name="${CSS.escape(path)}"]`) ?? document.querySelector<HTMLElement>("[aria-invalid=true]");
    if (!input) return;
    for (let parent = input.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    input.scrollIntoView({ block: "center" }); input.focus({ preventScroll: true });
  });
}
