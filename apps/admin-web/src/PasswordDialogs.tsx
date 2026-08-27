import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, authService } from "@lifewood/api-client";
import type { AdminUser } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";

export function ChangeOwnPasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: () => { queryClient.clear(); window.location.reload(); },
  });
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), change.isPending);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) { setMismatch(true); return; }
    setMismatch(false);
    change.mutate({ currentPassword: String(data.get("currentPassword") ?? ""), newPassword });
  };
  return <ModalFrame labelledBy="change-own-password-title" busy={change.isPending} onClose={requestClose}>
    <div className="modal-title"><h2 id="change-own-password-title">{t("admin.account.changePassword")}</h2><button type="button" aria-label={t("common.close")} disabled={change.isPending} onClick={requestClose}>×</button></div>
    <form onSubmit={submit} onChange={markDirty} aria-busy={change.isPending}>
      <label><span>{t("admin.account.currentPassword")}</span><input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required autoFocus /></label>
      <label><span>{t("admin.account.newPassword")}</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <label><span>{t("admin.account.confirmPassword")}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {(mismatch || change.isError) && <div className="message error" role="alert">{t(mismatch ? "admin.account.mismatch" : "admin.account.invalid")}</div>}
      <div className="modal-actions"><button type="button" disabled={change.isPending} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={change.isPending}>{t(change.isPending ? "admin.account.saving" : "admin.account.save")}</button></div>
    </form>
  </ModalFrame>;
}

export function ResetUserPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation();
  const [mismatch, setMismatch] = useState(false);
  const reset = useMutation({
    mutationFn: (newPassword: string) => adminService.resetUserPassword(user.id, newPassword),
    onSuccess: () => { showAdminToast(t("admin.feedback.passwordReset")); onClose(); },
  });
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), reset.isPending);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("newPassword") ?? "");
    if (password !== String(data.get("confirmPassword") ?? "")) { setMismatch(true); return; }
    setMismatch(false);
    reset.mutate(password);
  };
  return <ModalFrame labelledBy="reset-user-password-title" busy={reset.isPending} onClose={requestClose}>
    <div className="modal-title"><div><h2 id="reset-user-password-title">{t("admin.users.resetTitle")}</h2><p>{t("admin.users.resetFor", { name: user.displayName })}</p></div><button type="button" aria-label={t("common.close")} disabled={reset.isPending} onClick={requestClose}>×</button></div>
    <form onSubmit={submit} onChange={markDirty} aria-busy={reset.isPending}>
      <label><span>{t("admin.account.newPassword")}</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required autoFocus /></label>
      <label><span>{t("admin.account.confirmPassword")}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {(mismatch || reset.isError) && <div className="message error" role="alert">{t(mismatch ? "admin.account.mismatch" : "admin.account.invalid")}</div>}
      <div className="modal-actions"><button type="button" disabled={reset.isPending} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={reset.isPending}>{t(reset.isPending ? "admin.account.saving" : "admin.users.resetAction")}</button></div>
    </form>
  </ModalFrame>;
}
