import { useConfirm } from "./useConfirm";
import { useCallback, useEffect, useState, useRef } from "react";
import { useBlocker } from "react-router-dom";

export function useUnsavedClose(onClose: () => void, confirmMessage: string, busy = false) {
  const confirm = useConfirm();
  const asking = useRef<"close" | "route" | null>(null);
  const lifetime = useRef<object | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => { const scope = {}; lifetime.current = scope; return () => { lifetime.current = null; asking.current = null; }; }, []);
  const latest = useRef({ busy, onClose }); latest.current = { busy, onClose };
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(({currentLocation, nextLocation}) => {
    const stripLocale = (path: string) => path.replace(/^\/(zh-CN|en-US)(?=\/|$)/, "");
    const languageOnly = /^\/(zh-CN|en-US)(?:\/|$)/.test(currentLocation.pathname)
      && /^\/(zh-CN|en-US)(?:\/|$)/.test(nextLocation.pathname)
      && stripLocale(currentLocation.pathname) === stripLocale(nextLocation.pathname)
      && currentLocation.search === nextLocation.search && currentLocation.hash === nextLocation.hash;
    return (dirty || busy) && !languageOnly;
  });

  const blockerRef = useRef(blocker); blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (busy || asking.current === "close") {
      blocker.reset();
      return;
    }
    if (asking.current === "route") return;
    asking.current = "route";
    const scope = lifetime.current;
    void confirm(confirmMessage, false).then(accepted => {
      if (lifetime.current !== scope) return;
      const current = blockerRef.current;
      if (current.state !== "blocked") return;
      if (accepted && !latest.current.busy) current.proceed(); else current.reset();
    }).catch(() => { if (lifetime.current === scope && blockerRef.current.state === "blocked") blockerRef.current.reset(); })
      .finally(() => { if (lifetime.current === scope) asking.current = null; });
  }, [blocker, busy, confirmMessage, confirm]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [busy, dirty]);

  const requestClose = useCallback(async () => {
    if (latest.current.busy || asking.current || !lifetime.current) return;
    const scope = lifetime.current;
    asking.current = "close";
    try {
      if ((!dirtyRef.current || await confirm(confirmMessage, false)) && lifetime.current === scope && !latest.current.busy) latest.current.onClose();
    } catch { /* A failed confirmation must leave edits intact. */ }
    finally { if (lifetime.current === scope) asking.current = null; }
  }, [confirmMessage, confirm]);

  return { markDirty: () => { dirtyRef.current = true; setDirty(true); }, resetDirty: () => { dirtyRef.current = false; setDirty(false); }, requestClose };
}
