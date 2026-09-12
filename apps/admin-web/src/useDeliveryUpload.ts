import { useEffect, useRef, useState } from "react";
import { adminService, ApiError } from "@lifewood/api-client";

import type { FinalDelivery } from "@lifewood/domain";

type Attempt = { key: string; file: File; note: string };
type Phase = "idle" | "uploading" | "checking";
type Outcome = "idle" | "retry" | "unknown" | "revoked" | "error";
function uploadKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function useDeliveryUpload(projectId: string, onComplete: (delivery: FinalDelivery) => void) {
  const [phase, setPhase] = useState<Phase>("idle"), [outcome, setOutcome] = useState<Outcome>("idle");
  const [progress, setProgress] = useState(0), [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState<Attempt>();
  const active = useRef<object | null>(null), busy = useRef(false), controller = useRef<AbortController | undefined>(undefined);
  const callback = useRef(onComplete); callback.current = onComplete;
  useEffect(() => {
    const scope = {}; active.current = scope; busy.current = false;
    setAttempt(undefined); setPhase("idle"); setOutcome("idle"); setError(undefined); setProgress(0);
    return () => { active.current = null; controller.current?.abort(); };
  }, [projectId]);
  const run = async (file?: File, note = "") => {
    if (busy.current || !active.current) return;
    const current = attempt ?? (file ? { key: uploadKey(), file, note } : undefined);
    if (!current) return;
    const scope = active.current; const valid = () => active.current === scope;
    busy.current = true; setAttempt(current); setError(undefined);
    const complete = (delivery: FinalDelivery) => {
      if (!valid()) return;
      setError(undefined);
      if (delivery.revokedAt) { setOutcome("revoked"); return; }
      setAttempt(undefined); setOutcome("idle"); callback.current(delivery);
    };
    const inspect = async () => {
      setPhase("checking");
      try {
        const result = await adminService.getDeliveryUpload(projectId, current.key);
        if (!valid()) return false;
        if (result.recorded && result.delivery) { complete(result.delivery); return false; }
        if (result.recorded) throw new Error("Missing delivery result");
        setOutcome("retry"); return true;
      } catch (cause) { if (valid()) { setOutcome("unknown"); setError(cause); } return false; }
    };
    try {
      if (attempt) {
        const missing = await inspect();
        if (!valid() || outcome === "unknown" || !missing) return;
      }
      setOutcome("idle"); setProgress(0); setPhase("uploading");
      const abort = new AbortController(); controller.current = abort;
      try {
        const delivery = await adminService.publishFinalDelivery(projectId, current.file, current.note, {
          uploadId: current.key, signal: abort.signal,
          onProgress: value => { if (valid()) setProgress(value); },
        });
        complete(delivery);
      } catch (cause) {
        if (!valid()) return;
        setError(cause);
        const missing = await inspect();
        if (valid() && missing && cause instanceof ApiError && !cause.details.retryable) setOutcome("error");
      }
    } finally {
      if (valid()) { busy.current = false; controller.current = undefined; setPhase("idle"); }
    }
  };
  const reset = () => {
    if (busy.current || outcome === "unknown") return;
    setAttempt(undefined); setOutcome("idle"); setError(undefined); setProgress(0);
  };
  return { phase, outcome, progress, error, fileName: attempt?.file.name, note: attempt?.note, frozen: Boolean(attempt), isPending: phase !== "idle", run, reset,
    cancel: () => controller.current?.abort() };
}
