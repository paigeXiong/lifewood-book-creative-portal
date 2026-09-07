import { useContext, useEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../useConfirm";

function BackGuard({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const blocker = useBlocker(({ historyAction }) => dirty && historyAction === "POP");
  const latest = useRef(blocker); latest.current = blocker;
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || asking.current) return;
    asking.current = true;
    void confirm(t("wizard.unsavedChanges"), false).then(accepted => {
      asking.current = false;
      if (latest.current.state !== "blocked") return;
      if (accepted) latest.current.proceed(); else latest.current.reset();
    });
  }, [blocker, confirm, t]);
  return null;
}

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    document.body.dataset.unsavedChanges = String(dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty && document.body.dataset.unsavedChanges === "true") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); delete document.body.dataset.unsavedChanges; };
  }, [dirty]);
  return router ? <BackGuard dirty={dirty} /> : null;
}
