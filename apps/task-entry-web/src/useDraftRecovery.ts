import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale, TaskDraft } from "@lifewood/domain";
import { recoveryFields, type RecoveryField, type RecoveryValues } from "./draft-recovery";

export type DraftComparison = { latest: TaskDraft; snapshot: string; fields: RecoveryField[] };
export function useDraftRecovery(taskId: string | undefined, locale: SupportedLocale, snapshot: () => string,
  apply: (draft: TaskDraft, fields: RecoveryField[]) => void, valuesFromDraft: (draft: TaskDraft) => RecoveryValues) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string>();
  const [comparison, setComparison] = useState<DraftComparison>();
  const callbacks = useRef({ snapshot, apply, valuesFromDraft }); callbacks.current = { snapshot, apply, valuesFromDraft };
  const scope = useRef<object | null>(null); const pending = useRef<object | null>(null);
  useEffect(() => {
    scope.current = {}; pending.current = null; setLoading(false); setError(undefined); setComparison(undefined);
    return () => { scope.current = null; };
  }, [taskId, locale]);
  const review = (latest: TaskDraft) => {
    const current = callbacks.current.snapshot();
    setComparison({ latest, snapshot: current, fields: recoveryFields(JSON.parse(current), callbacks.current.valuesFromDraft(latest)) });
  };
  const reload = async () => {
    if (pending.current || !taskId) return;
    const currentScope = scope.current; pending.current = currentScope;
    setLoading(true); setError(undefined);
    try {
      const latest = await projectService.getProject(taskId, locale);
      if (scope.current === currentScope) review(latest);
    } catch (cause) {
      if (scope.current === currentScope) setError(`${t("saveRecovery.reloadFailed")} ${localizedApiError(cause, t)}`);
    } finally {
      if (pending.current === currentScope) pending.current = null;
      if (scope.current === currentScope) setLoading(false);
    }
  };
  const accept = async (selected: Set<number>) => {
    if (pending.current || !taskId || !comparison) return;
    const currentScope = scope.current; pending.current = currentScope;
    setLoading(true); setError(undefined);
    try {
      const latest = await projectService.getProject(taskId, locale);
      if (scope.current !== currentScope) return;
      if (latest.version !== comparison.latest.version || callbacks.current.snapshot() !== comparison.snapshot) {
        review(latest); setError(t("saveRecovery.changedAgain")); return;
      }
      if (latest.status !== "draft" && selected.size) { setError(t("saveRecovery.notEditable")); return; }
      const fields = comparison.fields.filter((field, index) => field.recoverable && selected.has(index));
      callbacks.current.apply(latest, fields); setComparison(undefined);
    } catch (cause) {
      if (scope.current === currentScope) setError(`${t("saveRecovery.reloadFailed")} ${localizedApiError(cause, t)}`);
    } finally {
      if (pending.current === currentScope) pending.current = null;
      if (scope.current === currentScope) setLoading(false);
    }
  };
  return { reload, loading, error, comparison, accept, close: () => { if (!pending.current) { setComparison(undefined); setError(undefined); } } };
}

export { focusSaveIssue } from "./form-focus";
