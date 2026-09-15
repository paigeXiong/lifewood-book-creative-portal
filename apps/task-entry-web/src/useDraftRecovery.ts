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
  const scope = useRef<object | null>(null); const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    scope.current = {}; pending.current = null; setLoading(false); setError(undefined); setComparison(undefined);
    return () => { pending.current?.abort(); pending.current = null; scope.current = null; };
  }, [taskId, locale]);
  useEffect(() => {
    const stop = () => {
      scope.current = null;
      pending.current?.abort(); pending.current = null;
      setLoading(false); setError(undefined); setComparison(undefined);
    };
    window.addEventListener("lw-account-changed", stop);
    return () => window.removeEventListener("lw-account-changed", stop);
  }, []);
  const close = () => {
    pending.current?.abort(); pending.current = null;
    setLoading(false); setComparison(undefined); setError(undefined);
  };
  const review = (latest: TaskDraft) => {
    const current = callbacks.current.snapshot();
    setComparison({ latest, snapshot: current, fields: recoveryFields(JSON.parse(current), callbacks.current.valuesFromDraft(latest)) });
  };
  const reload = async () => {
    if (pending.current || !scope.current || !taskId) return;
    const currentScope = scope.current;
    const controller = new AbortController(); pending.current = controller;
    const active = () => !controller.signal.aborted && pending.current === controller && scope.current === currentScope;
    setLoading(true); setError(undefined);
    try {
      const latest = await projectService.getProject(taskId, locale, controller.signal);
      if (active()) review(latest);
    } catch (cause) {
      if (active()) setError(`${t("saveRecovery.reloadFailed")} ${localizedApiError(cause, t)}`);
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  };
  const accept = async (selected: Set<number>) => {
    if (pending.current || !scope.current || !taskId || !comparison) return;
    const currentScope = scope.current;
    const controller = new AbortController(); pending.current = controller;
    const active = () => !controller.signal.aborted && pending.current === controller && scope.current === currentScope;
    setLoading(true); setError(undefined);
    try {
      const latest = await projectService.getProject(taskId, locale, controller.signal);
      if (!active()) return;
      if (latest.version !== comparison.latest.version || callbacks.current.snapshot() !== comparison.snapshot) {
        review(latest); setError(t("saveRecovery.changedAgain")); return;
      }
      if (latest.status !== "draft" && selected.size) { setError(t("saveRecovery.notEditable")); return; }
      const fields = comparison.fields.filter((field, index) => field.recoverable && selected.has(index));
      callbacks.current.apply(latest, fields); setComparison(undefined);
    } catch (cause) {
      if (active()) setError(`${t("saveRecovery.reloadFailed")} ${localizedApiError(cause, t)}`);
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  };
  return { reload, loading, error, comparison, accept, close };
}

export { focusSaveIssue } from "./form-focus";
