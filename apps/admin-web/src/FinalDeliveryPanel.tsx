import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";

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
  const deliveries = useQuery({ queryKey: ["admin-deliveries", projectId], queryFn: () => adminService.listDeliveries(projectId) });
  const publish = useMutation({
    mutationFn: ({ file, note }: { file: File; note: string }) => adminService.publishFinalDelivery(projectId, file, note),
    onSuccess: async () => {
      setOpen(false);
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
      publish.mutate({ file, note: String(data.get("note") ?? "").trim() });
    }
  };

  return <section className="detail-section delivery-admin">
    <div className="section-title-row"><div><h3>{t("admin.delivery.title")}</h3><p>{t(canPublish ? "admin.delivery.shortcutHint" : "admin.delivery.draftHint")}</p></div><button className="primary" disabled={!canPublish} onClick={() => { setFileInvalid(false); setOpen(true); }}>{t("admin.delivery.upload")}</button></div>
    {deliveries.isError && <div className="message error" role="alert">{localizedApiError(deliveries.error, t)}</div>}
    {deliveries.data?.length ? <ol className="delivery-list">{deliveries.data.map((item) => <li key={item.id}><div><strong>{item.fileName}</strong><small>{formatSize(item.sizeBytes, locale)} · {formatDate(item.publishedAt, locale)}</small>{item.note && <p>{item.note}</p>}</div><a href={`/api/admin/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(item.id)}/file`}>{t("admin.delivery.download")}</a></li>)}</ol> : !deliveries.isPending && <p className="muted">{t("admin.delivery.empty")}</p>}
    {open && canPublish && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !publish.isPending) setOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delivery-dialog-title"><div className="modal-title"><h2 id="delivery-dialog-title">{t("admin.delivery.dialogTitle")}</h2><button aria-label={t("common.close")} disabled={publish.isPending} onClick={() => setOpen(false)}>×</button></div><form onSubmit={submit} aria-busy={publish.isPending}>
      <div className="delivery-warning"><strong>{t("admin.delivery.immediateTitle")}</strong><p>{t("admin.delivery.immediateBody")}</p></div>
      <label><span>{t("admin.delivery.file")}</span><input name="file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" required /><small>{t("admin.delivery.fileHint")}</small></label>
      <label><span>{t("admin.delivery.note")}</span><textarea name="note" rows={3} maxLength={2000} placeholder={t("admin.delivery.notePlaceholder")} /></label>
      {fileInvalid && <div className="message error" role="alert">{t("errors.delivery.file")}</div>}
      {publish.isError && <div className="message error" role="alert">{localizedApiError(publish.error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={publish.isPending} onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="primary" disabled={publish.isPending}>{t(publish.isPending ? "admin.delivery.publishing" : "admin.delivery.publish")}</button></div>
    </form></section></div>}
  </section>;
}
