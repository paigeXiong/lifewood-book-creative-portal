import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { captureAccountGuard, localizedApiError, projectService } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { chooseDeliveryTarget, openDeliveryWriter } from "../delivery-save-target";

function formatSize(bytes: number, locale: SupportedLocale) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1_000_000);
}

export function FinalDeliverySection({ projectId, locale }: { projectId: string; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const activeDownload = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState<string>();
  const [committing, setCommitting] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>();
  const [downloadSaved, setDownloadSaved] = useState<false | "browser" | "file">(false);
  useEffect(() => {
    setDownloading(undefined);
    setCommitting(false);
    setDownloadError(undefined);
    setDownloadSaved(false);
    const accountChanged = () => { cancelDownload(); setDownloadSaved(false); };
    window.addEventListener("lw-account-changed", accountChanged);
    return () => { window.removeEventListener("lw-account-changed", accountChanged); activeDownload.current?.abort(); activeDownload.current = null; };
  }, [projectId, locale]);

  function cancelDownload() {
    activeDownload.current?.abort();
    activeDownload.current = null;
    setDownloading(undefined);
  }

  async function download(id: string, fileName: string, sizeBytes: number) {
    if (activeDownload.current) return;
    const controller = new AbortController();
    const assertAccount = captureAccountGuard();
    let writer: FileSystemWritableFileStream | undefined;
    activeDownload.current = controller;
    setDownloading(id);
    setCommitting(false);
    setDownloadError(undefined);
    setDownloadSaved(false);
    try {
      const target = await chooseDeliveryTarget(fileName, sizeBytes);
      controller.signal.throwIfAborted();
      assertAccount();
      if (target) {
        writer = await openDeliveryWriter(target, controller.signal);
        assertAccount();
        await projectService.downloadDeliveryTo(projectId, id, locale, controller.signal, writer, () => setCommitting(true));
        if (!controller.signal.aborted) setDownloadSaved("file");
        return;
      }
      const blob = await projectService.downloadDelivery(projectId, id, locale, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      setDownloadSaved("browser");
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setDownloadError(error);
    } finally {
      if (writer) await writer.abort().catch(() => {});
      if (activeDownload.current === controller) {
        activeDownload.current = null;
        setDownloading(undefined);
        setCommitting(false);
      }
    }
  }
  const deliveries = useQuery({
    queryKey: ["project-deliveries", projectId, locale],
    queryFn: () => projectService.listDeliveries(projectId, locale),
    refetchOnWindowFocus: true,
    // Published files can still be replaced or revoked while this page stays open.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (downloading && (deliveries.isError || !deliveries.data?.some(item => item.id === downloading))) cancelDownload();
  }, [deliveries.data, deliveries.isError, downloading]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  if (deliveries.isPending) return <section className="form-panel customer-delivery" aria-busy="true"><h2><span>✓</span>{t("delivery.title")}</h2><p>{t("common.loading")}</p></section>;
  if (deliveries.isError) return <section className="form-panel customer-delivery"><h2><span>!</span>{t("delivery.title")}</h2><div className="inline-error" role="alert">{localizedApiError(deliveries.error, t)} <button type="button" className="button button-secondary" onClick={() => void deliveries.refetch()}>{t("common.retry")}</button></div></section>;
  if (!deliveries.data.length) return <section className="form-panel customer-delivery pending"><h2><span>○</span>{t("delivery.title")}</h2><strong>{t("delivery.pendingTitle")}</strong><p>{t("delivery.pendingBody")}</p></section>;

  return <section className="form-panel customer-delivery ready"><div className="customer-delivery-heading"><div><h2><span>✓</span>{t("delivery.title")}</h2><strong>{t("delivery.readyTitle")}</strong><p>{t("delivery.readyBody")}</p></div><span className="delivery-ready-badge">{t("delivery.readyBadge")}</span></div>
    <ol>{deliveries.data.map((item, index) => <li key={item.id}>
      <div><strong>{item.fileName}</strong><small>{t("delivery.fileMeta", { size: formatSize(item.sizeBytes, locale), date: date.format(new Date(item.publishedAt)) })}</small>{item.note && <p>{item.note}</p>}</div>
      <button type="button" className={index === 0 ? "button button-primary" : "button button-secondary"} disabled={Boolean(downloading)} aria-busy={downloading === item.id} onClick={() => void download(item.id, item.fileName, item.sizeBytes)}>{t(downloading === item.id ? "delivery.downloading" : index === 0 ? "delivery.downloadLatest" : "delivery.download")}</button>
    </li>)}</ol>
    {downloading && <div role="status">{t(committing ? "delivery.saving" : "delivery.downloading")} <button type="button" className="button button-secondary" disabled={committing} onClick={cancelDownload}>{t("common.cancel")}</button></div>}
    {downloadError != null && <div className="inline-error" role="alert">{localizedApiError(downloadError, t)}</div>}
    {downloadSaved && <p role="status">{t(downloadSaved === "file" ? "delivery.fileSaved" : "delivery.downloadSaved")}</p>}
  </section>;
}
