import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, authService, captureAccountGuard, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";

export function ChangePasswordDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const frameRef = useRef<HTMLDivElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const [mismatch, setMismatch] = useState(false);
  const [invalidated, setInvalidated] = useState(false);
  const lifetime = useRef({ mounted: false, accountChanged: false });
  const submitLock = useRef(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const isCurrent = () => lifetime.current.mounted && !lifetime.current.accountChanged && queryClient.getQueryData<{ id: string }>(["current-user"])?.id === userId;
  const change = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async (credentials: { currentPassword: string; newPassword: string }) => {
      const guard = captureAccountGuard();
      const check = () => { guard(); if (!isCurrent()) throw new ApiError({ code: "auth.account_changed", messageKey: "accountSwitch.changed", retryable: false }); };
      check(); await authService.changePassword(credentials); check();
    },
    onSuccess: async () => {
      if (!isCurrent()) return;
      queryClient.clear();
      if (isSupportedLocale(locale)) navigate("/" + locale + "/login", { replace: true });
    },
    onSettled: () => { submitLock.current = false; },
  });
  busyRef.current = change.isPending;
  onCloseRef.current = onClose;

  useEffect(() => {
    lifetime.current.mounted = true;
    const stop = () => {
      lifetime.current.accountChanged = true;
      frameRef.current?.querySelector("form")?.reset();
      setInvalidated(true);
    };
    window.addEventListener("lw-account-changed", stop);
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = frameRef.current;
    currentPasswordRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (lifetime.current.accountChanged || (!busyRef.current && !submitLock.current))) onCloseRef.current();
      if (event.key !== "Tab" || !frame) return;
      const focusable = Array.from(frame.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
      if (!focusable.length) { event.preventDefault(); frame.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      lifetime.current.mounted = false;
      window.removeEventListener("lw-account-changed", stop);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCurrent() || submitLock.current || change.isPending) return;
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setMismatch(true);
      confirmPasswordRef.current?.focus();
      return;
    }
    setMismatch(false);
    submitLock.current = true;
    change.mutate({ currentPassword, newPassword });
  };

  const canClose = invalidated || (!change.isPending && !submitLock.current);
  return <div className="password-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && canClose) onClose(); }}>
    <div ref={frameRef} className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title" tabIndex={-1}>
      <div className="password-dialog-title"><h2 id="change-password-title">{t("nav.changePassword")}</h2><button type="button" aria-label={t("common.close")} disabled={!canClose} onClick={onClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
      {invalidated ? <p className="account-error" role="alert">{t("accountSwitch.changed")}</p> : <form onSubmit={submit} aria-busy={change.isPending}>
        <label><span>{t("nav.currentPassword")}</span><input ref={currentPasswordRef} name="currentPassword" type="password" disabled={change.isPending} autoComplete="current-password" maxLength={128} required aria-invalid={change.isError || undefined} aria-describedby={change.isError ? "change-password-error" : undefined} /></label>
        <label><span>{t("nav.newPassword")}</span><input name="newPassword" type="password" disabled={change.isPending} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <label><span>{t("nav.confirmNewPassword")}</span><input ref={confirmPasswordRef} name="confirmPassword" type="password" disabled={change.isPending} autoComplete="new-password" minLength={8} maxLength={128} required aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "change-password-error" : undefined} onChange={() => { if (mismatch) setMismatch(false); }} /></label>
        {(mismatch || change.isError) && <p id="change-password-error" className="account-error" role="alert">{mismatch ? t("nav.passwordMismatch") : localizedApiError(change.error, t)}</p>}
        <div className="password-actions"><button type="button" disabled={change.isPending} onClick={onClose}>{t("common.cancel")}</button><button className="button-primary" disabled={change.isPending}>{t(change.isPending ? "nav.savingPassword" : "nav.savePassword")}</button></div>
      </form>}
    </div>
  </div>;
}
