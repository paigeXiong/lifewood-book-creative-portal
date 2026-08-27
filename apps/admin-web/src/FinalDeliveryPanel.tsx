import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { showAdminToast } from "./Toast";

function formatSize(bytes: number, locale: SupportedLocale) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1_000_000);
}

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function FinalDeliveryPanel({ projectId, projectStatus, locale }: { projectId: string; projectStatus: string; locale: SupportedLocale }) {
  const canPublish = projectStatus === "submitted";
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fileInvalid, setFileInvalid] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => uploadControllerRef.current?.abort(), [projectId]);
  const deliveries = useQuery({ queryKey: ["admin-deliveries", projectId], queryFn: () => adminService.listDeliveries(projectId) });
  const publish = useMutation({
    mutationFn: ({ file, note, controller }: { file: File; note: string; controller: AbortController }) => adminService.publishFinalDelivery(projectId, file, note, { signal: controller.signal, onProgress: setUploadProgress }),
    onSuccess: async () => {
      setOpen(false);
      showAdminToast(t("admin.feedback.deliveryPublished"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-deliveries", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-projects"] }),
      ]);
    },
    onSettled: (_data, _error, variables) => {
      if (uploadControllerRef.current === variables.controller) uploadControllerRef.current = undefined;
    },
  });
  const revoke = useMutation({
    mutationFn: (deliveryId: string) => adminService.revokeFinalDelivery(projectId, deliveryId),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.deliveryRevoked"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-deliveries", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-projects"] }),
      ]);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      const invalid = file.size > 500_000_000 || (Boolean(file.type) && !["video/mp4", "video/quicktime"].includes(file.type));
      setFileInvalid(invalid);
      if (invalid) return;
      const controller = new AbortController();
      setUploadProgress(0);
      uploadControllerRef.current = controller;
      publish.mutate({ file, note: String(data.get("note") ?? "").trim(), controller });
    }
  };

  return <section className="detail-section delivery-admin">
    <div className="section-title-row"><div><h3>{t("admin.delivery.title")}</h3><p>{t(canPublish ? "admin.delivery.shortcutHint" : "admin.delivery.draftHint")}</p></div><button className="primary" disabled={!canPublish || publish.isPending} onClick={() => { publish.reset(); setFileInvalid(false); setOpen(true); }}>{t("admin.delivery.upload")}</button></div>
    {deliveries.isError && <div className="message error" role="alert">{localizedApiError(deliveries.error, t)}</div>}
    {deliveries.data?.length ? <ol className="delivery-list">{deliveries.data.map((item) => <li className={item.revokedAt ? "revoked" : undefined} key={item.id}><div><strong>{item.fileName}</strong><small>{formatSize(item.sizeBytes, locale)} · {formatDate(item.publishedAt, locale)}</small>{item.note && <p>{item.note}</p>}</div><div className="delivery-actions">
      {item.revokedAt
        ? <span className="muted">{t("admin.delivery.revoked")}</span>
        : <>
          <a href={`/api/admin/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(item.id)}/file`}>{t("admin.delivery.download")}</a>
          <button
            className="danger-link"
            type="button"
            disabled={revoke.isPending}
            onClick={() => { if (window.confirm(t("admin.delivery.revokeConfirm"))) revoke.mutate(item.id); }}
          >{t("admin.delivery.revoke")}</button>
        </>}
    </div></li>)}</ol> : !deliveries.isPending && <p className="muted">{t("admin.delivery.empty")}</p>}
    {revoke.isError && <div className="message error" role="alert">{localizedApiError(revoke.error, t)}</div>}
    {open && canPublish && <ModalFrame labelledBy="delivery-dialog-title" busy={publish.isPending} onClose={() => setOpen(false)}><div className="modal-title"><h2 id="delivery-dialog-title">{t("admin.delivery.dialogTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={publish.isPending} onClick={() => setOpen(false)}>×</button></div><form onSubmit={submit} aria-busy={publish.isPending}>
      <div className="delivery-warning"><strong>{t("admin.delivery.immediateTitle")}</strong><p>{t("admin.delivery.immediateBody")}</p></div>
      <label><span>{t("admin.delivery.file")}</span><input name="file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" required /><small>{t("admin.delivery.fileHint")}</small></label>
      <label><span>{t("admin.delivery.note")}</span><textarea name="note" rows={3} maxLength={2000} placeholder={t("admin.delivery.notePlaceholder")} /></label>
      {fileInvalid && <div className="message error" role="alert">{t("errors.delivery.file")}</div>}
      {publish.isPending && <div className="upload-progress"><span>{t("admin.delivery.progress", { percent: uploadProgress })}</span><button type="button" onClick={() => { uploadControllerRef.current?.abort(); setOpen(false); }}>{t("admin.delivery.cancelUpload")}</button><progress value={uploadProgress} max={100} aria-label={t("admin.delivery.progress", { percent: uploadProgress })} /></div>}
      {publish.isError && publish.error instanceof DOMException && publish.error.name === "AbortError" ? null : publish.isError && <div className="message error" role="alert">{localizedApiError(publish.error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={publish.isPending} onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="primary" disabled={publish.isPending}>{t(publish.isPending ? "admin.delivery.publishing" : "admin.delivery.publish")}</button></div>
    </form></ModalFrame>}
  </section>;
}
