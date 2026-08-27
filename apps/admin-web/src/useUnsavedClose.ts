import { useCallback, useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";

export function useUnsavedClose(onClose: () => void, confirmMessage: string, busy = false) {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty || busy);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (busy) {
      blocker.reset();
      return;
    }
    if (window.confirm(confirmMessage)) blocker.proceed();
    else blocker.reset();
  }, [blocker, busy, confirmMessage]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [busy, dirty]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (!dirty || window.confirm(confirmMessage)) onClose();
  }, [busy, confirmMessage, dirty, onClose]);

  return { markDirty: () => setDirty(true), requestClose };
}
