import { useTranslation } from "react-i18next";
import { useConfirmation } from "@lifewood/ui/confirmation";
export function useConfirm() {
  const { t } = useTranslation();
  return useConfirmation({ title: t("common.confirmTitle"), confirm: t("common.confirmAction"), cancel: t("common.cancel") });
}
