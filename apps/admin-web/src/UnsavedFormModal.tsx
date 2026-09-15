import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import { useUnsavedClose } from "./useUnsavedClose";

// Mount only while the editor is open so each editing session starts clean.
export function UnsavedFormModal({ labelledBy, busy, onClose, children }: {
  labelledBy: string; busy: boolean; onClose: () => void;
  children: (controls: ReturnType<typeof useUnsavedClose>) => ReactNode;
}) {
  const { t } = useTranslation();
  const controls = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  return <ModalFrame labelledBy={labelledBy} busy={busy} onClose={controls.requestClose}>{children(controls)}</ModalFrame>;
}
