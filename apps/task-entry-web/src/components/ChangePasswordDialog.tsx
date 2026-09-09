import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { authService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const frameRef = useRef<HTMLDivElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const [mismatch, setMismatch] = useState(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const change = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: async () => {
      queryClient.clear();
      if (isSupportedLocale(locale)) navigate("/" + locale + "/login", { replace: true });
    },
  });
  busyRef.current = change.isPending;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = frameRef.current;
    currentPasswordRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab" || !frame) return;
      const focusable = Array.from(frame.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setMismatch(true);
      confirmPasswordRef.current?.focus();
      return;
    }
    setMismatch(false);
    change.mutate({ currentPassword, newPassword });
  };

  return <div className="password-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !change.isPending) onClose(); }}>
    <div ref={frameRef} className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div className="password-dialog-title"><h2 id="change-password-title">{t("nav.changePassword")}</h2><button type="button" aria-label={t("common.close")} disabled={change.isPending} onClick={onClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
      <form onSubmit={submit} aria-busy={change.isPending}>
        <label><span>{t("nav.currentPassword")}</span><input ref={currentPasswordRef} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required aria-invalid={change.isError || undefined} aria-describedby={change.isError ? "change-password-error" : undefined} /></label>
        <label><span>{t("nav.newPassword")}</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <label><span>{t("nav.confirmNewPassword")}</span><input ref={confirmPasswordRef} name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "change-password-error" : undefined} onChange={() => { if (mismatch) setMismatch(false); }} /></label>
        {(mismatch || change.isError) && <p id="change-password-error" className="account-error" role="alert">{mismatch ? t("nav.passwordMismatch") : localizedApiError(change.error, t)}</p>}
        <div className="password-actions"><button type="button" disabled={change.isPending} onClick={onClose}>{t("common.cancel")}</button><button className="button-primary" disabled={change.isPending}>{t(change.isPending ? "nav.savingPassword" : "nav.savePassword")}</button></div>
      </form>
    </div>
  </div>;
}
