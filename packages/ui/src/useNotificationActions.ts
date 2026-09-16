import { useEffect, useRef, useState } from "react";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { captureAccountGuard, notificationService } from "@lifewood/api-client";

type Confirmation = (signal: AbortSignal) => Promise<boolean>;

type Action = { action: string; ids?: number[]; through?: number };

// Shared by the full notification center and the bell's compact center.
export function useNotificationActions(user: string, scope: string, onSuccess: () => void) {
  const client = useQueryClient();
  const mutationKey = ["notification-action", user];
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: () => true });
  const lifetime = useRef<AbortController | null>(null), lock = useRef(false);
  const [failure, setFailure] = useState<{ error: unknown; variables: Action; confirm?: Confirmation }>();
  const success = useRef(onSuccess); success.current = onSuccess;
  useEffect(() => {
    const token = new AbortController(); lifetime.current = token; lock.current = false; setFailure(undefined);
    const stop = () => { token.abort(); lifetime.current = null; setFailure(undefined); };
    window.addEventListener("lw-account-changed", stop);
    return () => { token.abort(); lifetime.current = null; window.removeEventListener("lw-account-changed", stop); };
  }, [user, scope]);
  const isBusy = () => lock.current || client.getMutationCache().findAll({ mutationKey, status: "pending" }).length > 0;
  const operation = useMutation({ mutationKey, mutationFn: async ({ variables, token, guard, confirm }: {
    variables: Action; token: AbortController; guard: () => void; confirm?: Confirmation;
  }) => {
    const active = () => lifetime.current === token && !token.signal.aborted;
    let requested = false;
    try {
      if (!active()) return;
      guard();
      if (confirm && !await confirm(token.signal)) return;
      if (!active()) return;
      guard(); requested = true;
      await notificationService.update(variables.action, variables.ids, variables.through);
      guard();
      if (active()) success.current();
    } catch (error) {
      if (active()) setFailure({ error, variables, confirm: requested ? undefined : confirm });
    } finally {
      // A lost response may still have applied the write. Reconcile before
      // unlocking, even when the center was closed and opened again.
      if (requested) {
        try { guard(); await client.invalidateQueries({ queryKey: ["notifications", user] }); } catch { /* The feed exposes refresh errors. */ }
      }
      if (active()) lock.current = false;
    }
  } });
  const mutate = (variables: Action, confirm?: Confirmation) => {
    if (!user || !lifetime.current || isBusy()) return;
    lock.current = true; setFailure(undefined);
    operation.mutate({ variables: { ...variables, ids: variables.ids?.slice() }, token: lifetime.current, guard: captureAccountGuard(), confirm });
  };
  return { mutate, isBusy, isPending: pending.length > 0, error: failure?.error, variables: failure?.variables, retry: () => { if (failure) mutate(failure.variables, failure.confirm); }, reset: () => setFailure(undefined) };
}
