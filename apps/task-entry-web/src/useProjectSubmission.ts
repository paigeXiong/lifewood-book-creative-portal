import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, projectService } from "@lifewood/api-client";
import type { ProjectValidationResult, SupportedLocale, TaskDraft } from "@lifewood/domain";
import { createId } from "./create-id";

type Phase = "idle" | "validating" | "submitting" | "checking";
type Outcome = "idle" | "unknown" | "retry" | "changed" | "error";
type Attempt = { taskId: string; version: number; key: string; sent: boolean };
const uncertain = (error: unknown) => !(error instanceof ApiError) || error.details.retryable;

export function useProjectSubmission(taskId: string | undefined, locale: SupportedLocale, draft: TaskDraft | undefined, onSubmitted: (draft: TaskDraft) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [error, setError] = useState<unknown>();
  const [validationIssues, setValidationIssues] = useState<ProjectValidationResult["fieldErrors"]>([]);
  const attempt = useRef<Attempt | undefined>(undefined);
  const scopeToken = useMemo(() => ({}), [taskId, locale]);
  const scope = useRef<object | null>(null); const pending = useRef<object | null>(null);
  const callback = useRef(onSubmitted); callback.current = onSubmitted;
  useEffect(() => {
    scope.current = scopeToken; pending.current = null; attempt.current = undefined;
    setPhase("idle"); setOutcome("idle"); setError(undefined); setValidationIssues([]);
    return () => { scope.current = null; };
  }, [scopeToken]);

  const run = async () => {
    if (pending.current || scope.current !== scopeToken || !taskId || !draft) return;
    const currentScope = scope.current;
    pending.current = currentScope;
    const active = () => scope.current === currentScope;
    const current = attempt.current?.taskId === taskId && attempt.current.version === draft.version
      ? attempt.current : { taskId, version: draft.version, key: createId().replaceAll("-", ""), sent: false };
    attempt.current = current;
    const checkOnly = outcome === "unknown";
    setError(undefined); setValidationIssues([]); setOutcome("idle");
    const complete = (submitted: TaskDraft) => {
      if (!active()) return;
      setOutcome("idle"); setError(undefined); callback.current(submitted);
    };
    // Reads never send or repeat a submission. A new version always needs another review.
    const inspect = async (): Promise<boolean> => {
      setPhase("checking");
      try {
        const latest = await projectService.getProject(current.taskId, locale);
        if (!active()) return false;
        if (latest.status === "submitted") { complete(latest); return false; }
        if (latest.status === "draft" && latest.version === current.version) { setOutcome("retry"); return true; }
        setOutcome("changed");
        setError(new ApiError({ code: "project.version_conflict", messageKey: "errors.project.versionConflict", retryable: false }));
        return false;
      } catch (cause) {
        if (active()) { setOutcome("unknown"); setError(cause); }
        return false;
      }
    };
    try {
      if (checkOnly || current.sent) {
        const stillDraft = await inspect();
        if (!active() || checkOnly || !stillDraft) return;
      }
      setPhase("validating"); setOutcome("idle");
      const validation = await projectService.validateProject(current.taskId, current.version, locale);
      if (!active()) return;
      if (!validation.valid) { setValidationIssues(validation.fieldErrors); return; }
      setPhase("submitting"); current.sent = true;
      const submitted = await projectService.submitProject(current.taskId, current.version, current.key, locale);
      if (active()) complete(submitted);
    } catch (cause) {
      if (!active()) return;
      const changed = cause instanceof ApiError && ["project.version_conflict", "project.not_editable"].includes(cause.details.code);
      if ((current.sent && uncertain(cause)) || changed) {
        await inspect();
      } else {
        setOutcome("error"); setError(cause);
        if (cause instanceof ApiError && cause.details.fieldErrors) setValidationIssues(cause.details.fieldErrors);
      }
    } finally {
      if (pending.current === currentScope) pending.current = null;
      if (active()) setPhase("idle");
    }
  };
  const reset = () => {
    if (pending.current || scope.current !== scopeToken) return;
    attempt.current = undefined; setOutcome("idle"); setError(undefined); setValidationIssues([]);
  };
  return { phase, outcome, error, validationIssues, isPending: phase !== "idle", isError: outcome !== "idle", mutate: () => { void run(); }, run, reset };
}
