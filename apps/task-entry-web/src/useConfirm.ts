import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@lifewood/ui/confirmation";
export function useConfirm() {
  const { t } = useTranslation();
  return useConfirmation({ title: t("common.confirmTitle"), confirm: t("common.confirmAction"), cancel: t("common.cancel") });
}

export function useConfirmLink() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const confirm = useConfirm();
  return async (event: MouseEvent<HTMLAnchorElement>, onAllowed?: () => void, documentNavigation = false) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (document.body.dataset.unsavedChanges !== "true") { onAllowed?.(); return; }
    const url = new URL(event.currentTarget.href);
    event.preventDefault();
    if (!await confirm(t("wizard.unsavedChanges"), false)) return;
    onAllowed?.();
    if (!documentNavigation && url.origin === window.location.origin) navigate(url.pathname + url.search + url.hash);
    else { document.body.dataset.unsavedChanges = "false"; window.location.assign(url.href); }
  };
}
