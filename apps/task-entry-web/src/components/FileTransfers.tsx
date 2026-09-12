import { useTranslation } from "react-i18next";

export type FileTransfer = {
  id: string;
  categoryId: string;
  file: File;
  status: "queued" | "uploading" | "error" | "cancelled";
  progress?: number;
  error?: string;
  characterId?: string;
};

export function FileTransfers<T extends FileTransfer>({ items, busy, onCancel, onRetry }: {
  items: T[];
  busy: boolean;
  onCancel: (id: string) => void;
  onRetry: (item: T) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return <ul className="transfer-list file-transfers">{items.map(item => {
    const active = item.status === "uploading";
    const pending = active || item.status === "queued";
    const status = item.status === "queued" ? t("voice.waitingUpload") : active
      ? item.progress === 100 ? t("fileTransfer.processing") : t("fileTransfer.progress", { percent: item.progress ?? 0 })
      : item.status === "cancelled" ? t("voice.uploadCancelled") : item.error;
    return <li key={item.id}>
      <div className="file-transfer-info">
        <span className="file-transfer-name" title={item.file.name}>{item.file.name}</span>
        <small role={item.status === "error" ? "alert" : "status"}>{status}</small>
        {active && <progress max={100} value={item.progress ?? 0} aria-label={t("fileTransfer.progressFor", { name: item.file.name })} />}
      </div>
      <div className="file-transfer-actions">
        {item.status === "queued" && !busy && !items.some(entry => entry.status === "error" || entry.status === "cancelled") && <button type="button" onClick={() => void onRetry(item)}>{t("fileTransfer.resume")}</button>}
        {pending ? <button type="button" aria-label={t("fileTransfer.cancelFor", { name: item.file.name })} onClick={() => onCancel(item.id)}>{t("voice.cancelUpload")}</button>
          : <><button type="button" disabled={busy} aria-label={t("fileTransfer.retryFor", { name: item.file.name })} onClick={() => void onRetry(item)}>{t("common.retry")}</button>
            <button type="button" disabled={busy} aria-label={t("fileTransfer.dismissFor", { name: item.file.name })} onClick={() => onCancel(item.id)}>{t("voice.remove")}</button></>}
      </div>
    </li>;
  })}</ul>;
}
