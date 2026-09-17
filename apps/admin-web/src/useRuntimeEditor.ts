import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, captureAccountGuard } from "@lifewood/api-client";
import type { RuntimeSettings, WebListenerSettings } from "@lifewood/domain";
import { useConfirm } from "./useConfirm";
import { showAdminToast } from "./Toast";

type Draft = { scheme: "http" | "https"; listenAddress: string; port: string; customer?: WebListenerSettings; admin?: WebListenerSettings };
export type RuntimeAction = "restart" | "shutdown";
function draftOf(value: RuntimeSettings): Draft { return { scheme: value.scheme, listenAddress: value.listenAddress, port: String(value.port), customer: value.customer, admin: value.admin }; }
function fingerprint(value: Draft | RuntimeSettings) {
  const listener = (item?: WebListenerSettings) => item && [item.shared, item.scheme, item.listenAddress.trim(), item.port];
  return JSON.stringify([value.scheme, value.listenAddress.trim(), Number(value.port), listener(value.customer), listener(value.admin)]);
}

export function useRuntimeEditor(userId: string, restartUrl: (settings: RuntimeSettings) => string) {
  const { t } = useTranslation(), confirm = useConfirm(), client = useQueryClient();
  const queryKey = ["admin-runtime-settings", userId];
  const settings = useQuery({ queryKey, queryFn: adminService.getRuntimeSettings, retry: false });
  const [baseline, setBaseline] = useState<RuntimeSettings>();
  const [draft, setDraft] = useState<Draft>({ scheme: "http", listenAddress: "", port: "" });
  const [confirmAction, setConfirmAction] = useState<RuntimeAction>();
  const [reloading, setReloading] = useState(false);
  const mounted = useRef(true), locked = useRef(false), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changed = !!baseline && fingerprint(draft) !== fingerprint(baseline);
  dirty.current = changed;
  const serverChanged = !!baseline && !!settings.data && fingerprint(settings.data) !== fingerprint(baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    if (settings.data && !dirty.current && !locked.current) { setBaseline(settings.data); setDraft(draftOf(settings.data)); }
  }, [settings.data, changed]);
  const mutationKey = ["admin-runtime-write", userId];
  const activeWrites = useIsMutating({ mutationKey }) > 0;
  const save = useMutation({ mutationKey, mutationFn: async (input: Parameters<typeof adminService.updateRuntimeSettings>[0]) => {
    const guard = captureAccountGuard();
    const updated = await adminService.updateRuntimeSettings(input); guard();
    await client.cancelQueries({ queryKey }); guard();
    client.setQueryData(queryKey, updated);
    return updated;
  }, retry: false, networkMode: "always" });
  const action = useMutation({ mutationKey, mutationFn: (value: RuntimeAction) => value === "restart" ? adminService.restartPlatform() : adminService.shutdownPlatform(), retry: false, networkMode: "always" });
  const busy = activeWrites || save.isPending || action.isPending || reloading;
  useEffect(() => {
    if (!changed && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [changed, busy]);
  function edit(patch: Partial<Draft>) { if (locked.current || busy) return; dirty.current = true; setDraft(value => ({ ...value, ...patch })); }
  async function submit() {
    if (locked.current || busy || !changed || serverChanged || settings.isError) return;
    locked.current = true; const guard = captureAccountGuard();
    const input = { ...draft, listenAddress: draft.listenAddress.trim(), port: Number(draft.port) };
    try {
      const updated = await save.mutateAsync(input); guard(); if (!mounted.current) return;
      dirty.current = false; setBaseline(updated); setDraft(draftOf(updated));
      showAdminToast(t("admin.feedback.runtimeSettingsSaved"));
    } catch { /* Preserve the draft and allow an explicit read after an uncertain write. */ }
    finally { locked.current = false; }
  }
  async function reload() {
    if (locked.current || busy) return;
    locked.current = true; setReloading(true); const guard = captureAccountGuard();
    try {
      if (changed && !await confirm(t("runtimeRecovery.reloadConfirm"), false)) return;
      guard(); if (!mounted.current) return;
      const result = await settings.refetch(); guard(); if (!mounted.current || !result.data || result.isError) return;
      dirty.current = false; setBaseline(result.data); setDraft(draftOf(result.data)); save.reset(); action.reset(); setConfirmAction(undefined);
    } catch { /* A failed reload leaves the draft intact. */ }
    finally { locked.current = false; if (mounted.current) setReloading(false); }
  }
  async function execute(value: RuntimeAction) {
    const current = settings.data;
    if (locked.current || busy || changed || settings.isError || !current || !(value === "restart" ? current.canRestart : current.canShutdown)) return;
    locked.current = true; const guard = captureAccountGuard(); const target = restartUrl(current);
    try {
      await action.mutateAsync(value); guard(); if (!mounted.current) return;
      setConfirmAction(undefined); showAdminToast(t(value === "restart" ? "admin.runtime.restartAccepted" : "admin.runtime.shutdownAccepted"));
      if (value === "restart") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { try { guard(); if (mounted.current) window.location.assign(target); } catch { /* Account changed. */ } }, 15_000);
      }
    } catch { /* Never replay restart/shutdown automatically after a connection failure. */ }
    finally { locked.current = false; }
  }
  return { settings, draft, edit, changed, serverChanged, busy, save, action, submit, reload, execute, confirmAction, setConfirmAction };
}
