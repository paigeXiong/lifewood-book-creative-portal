import { useConfirm } from "./useConfirm";
import { useCallback, useEffect, useState, useRef } from "react";
import { useBlocker } from "react-router-dom";

export function useUnsavedClose(onClose: () => void, confirmMessage: string, busy = false) {
  const confirm = useConfirm();
  const asking = useRef(false);
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
    if (busy) {
      blocker.reset();
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void confirm(confirmMessage, false).then(accepted => {
      asking.current = false;
      const current = blockerRef.current;
      if (current.state !== "blocked") return;
      if (accepted && !latest.current.busy) current.proceed(); else current.reset();
    });
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
    if (busy) return;
    if ((!dirty || await confirm(confirmMessage, false)) && !latest.current.busy) latest.current.onClose();
  }, [busy, confirmMessage, dirty, confirm]);

  return { markDirty: () => setDirty(true), requestClose };
}
