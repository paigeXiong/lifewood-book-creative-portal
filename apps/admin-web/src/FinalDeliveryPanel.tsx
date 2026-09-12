import { useDeliveryUpload } from "./useDeliveryUpload";
import {ProjectAction} from "./ProjectAction";
import { useConfirm } from "./useConfirm";
import { useState, type FormEvent } from "react";
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

export function FinalDeliveryPanel({ projectId, projectStatus, locale, canDeliver = true }: { canDeliver?: boolean; projectId: string; projectStatus: string; locale: SupportedLocale }) {
  const canPublish = canDeliver && projectStatus === "submitted";
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fileInvalid, setFileInvalid] = useState(false);
  const deliveries = useQuery({ queryKey: ["admin-deliveries", projectId], queryFn: () => adminService.listDeliveries(projectId) });
  const publish = useDeliveryUpload(projectId, () => {
    setOpen(false);
    showAdminToast(t("admin.feedback.deliveryPublished"));
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-deliveries", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin-project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin-projects"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-workbench"] }),
    ]);
  });
  const revoke = useMutation({
    mutationFn: (deliveryId: string) => adminService.revokeFinalDelivery(projectId, deliveryId),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.deliveryRevoked"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-deliveries", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-projects"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-workbench"] }),
      ]);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (publish.frozen) { void publish.run(); return; }
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      const invalid = file.size > 500_000_000 || (Boolean(file.type) && !["video/mp4", "video/quicktime"].includes(file.type));
      setFileInvalid(invalid);
      if (invalid) return;
      void publish.run(file, String(data.get("note") ?? "").trim());
    }
  };

  return <>
    <ProjectAction slot="delivery"><button type="button" className="primary" disabled={!canPublish || publish.isPending} title={!canPublish ? t("admin.delivery.draftHint") : undefined} onClick={() => { setFileInvalid(false); setOpen(true); }}>{t("admin.delivery.upload")}</button></ProjectAction>
    {(Boolean(deliveries.data?.length) || deliveries.isError || revoke.isError) && <section className="detail-section delivery-admin">
    <h3>{t("admin.delivery.title")}</h3>
    {deliveries.isError && <div className="message error" role="alert">{localizedApiError(deliveries.error, t)}</div>}
    {deliveries.data?.length ? <ol className="delivery-list">{deliveries.data.map((item) => <li className={item.revokedAt ? "revoked" : undefined} key={item.id}><div><strong>{item.fileName}</strong><small>{formatSize(item.sizeBytes, locale)} · {formatDate(item.publishedAt, locale)}</small>{item.note && <details className="delivery-note"><summary>{t("admin.delivery.note")}</summary><p>{item.note}</p></details>}</div><div className="delivery-actions">
      {item.revokedAt
        ? <span className="muted">{t("admin.delivery.revoked")}</span>
        : <>
          <a href={`/api/admin/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(item.id)}/file`}>{t("admin.delivery.download")}</a>
          <button
            className="danger-link"
            type="button"
            disabled={!canDeliver || revoke.isPending}
            onClick={async () => { if (await confirm(t("admin.delivery.revokeConfirm"))) revoke.mutate(item.id); }}
          >{t("admin.delivery.revoke")}</button>
        </>}
    </div></li>)}</ol> : null}
    {revoke.isError && <div className="message error" role="alert">{localizedApiError(revoke.error, t)}</div>}
    </section>}
    {open && canPublish && <ModalFrame labelledBy="delivery-dialog-title" busy={publish.isPending} onClose={() => setOpen(false)}><div className="modal-title"><h2 id="delivery-dialog-title">{t("admin.delivery.dialogTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={publish.isPending} onClick={() => setOpen(false)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div><form onSubmit={submit} aria-busy={publish.isPending}>
      <div className="delivery-warning"><strong>{t("admin.delivery.immediateTitle")}</strong><p>{t("admin.delivery.immediateBody")}</p></div>
      <label><span>{t("admin.delivery.file")}</span><input disabled={publish.frozen} name="file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" required /><small>{t("admin.delivery.fileHint")}</small></label>
      <label><span>{t("admin.delivery.note")}</span><textarea disabled={publish.frozen} name="note" rows={3} maxLength={2000} placeholder={t("admin.delivery.notePlaceholder")} /></label>
      {publish.frozen && <p className="delivery-attempt">{publish.fileName}{publish.note && <small>{publish.note}</small>}</p>}
      {fileInvalid && <div className="message error" role="alert">{t("errors.delivery.file")}</div>}
      {publish.isPending && <div className="upload-progress" role="status"><span>{t(publish.phase === "checking" ? "deliveryRecovery.checking" : publish.progress === 100 ? "deliveryRecovery.processing" : "admin.delivery.progress", { percent: publish.progress })}</span>{publish.phase === "uploading" && <button type="button" onClick={publish.cancel}>{t("admin.delivery.cancelUpload")}</button>}<progress value={publish.progress} max={100} aria-label={t("admin.delivery.progress", { percent: publish.progress })} /></div>}
      {publish.outcome !== "idle" && <div className="message" role="status">{t(`deliveryRecovery.${publish.outcome}`)}</div>}
      {Boolean(publish.error) && !(publish.error instanceof DOMException && publish.error.name === "AbortError") && <div className="message error" role="alert">{localizedApiError(publish.error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={publish.isPending} onClick={() => setOpen(false)}>{t("common.close")}</button>{publish.frozen && publish.outcome !== "unknown" && !publish.isPending && <button type="button" onClick={publish.reset}>{t("deliveryRecovery.chooseAgain")}</button>}{publish.outcome !== "revoked" && publish.outcome !== "error" && <button className="primary" disabled={publish.isPending}>{t(publish.isPending ? "admin.delivery.publishing" : publish.outcome === "unknown" ? "deliveryRecovery.check" : publish.frozen ? "deliveryRecovery.retryAction" : "admin.delivery.publish")}</button>}</div>
    </form></ModalFrame>}
  </>;
}
