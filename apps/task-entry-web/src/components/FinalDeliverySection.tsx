import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { localizedApiError, projectService } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";

function formatSize(bytes: number, locale: SupportedLocale) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1_000_000);
}

export function FinalDeliverySection({ projectId, locale }: { projectId: string; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const deliveries = useQuery({
    queryKey: ["project-deliveries", projectId, locale],
    queryFn: () => projectService.listDeliveries(projectId, locale),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => Array.isArray(query.state.data) && query.state.data.length > 0 ? false : 10_000,
    refetchIntervalInBackground: false,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  if (deliveries.isPending) return <section className="form-panel customer-delivery" aria-busy="true"><h2><span>✓</span>{t("delivery.title")}</h2><p>{t("common.loading")}</p></section>;
  if (deliveries.isError) return <section className="form-panel customer-delivery"><h2><span>!</span>{t("delivery.title")}</h2><div className="inline-error" role="alert">{localizedApiError(deliveries.error, t)} <button className="button button-secondary" onClick={() => void deliveries.refetch()}>{t("common.retry")}</button></div></section>;
  if (!deliveries.data.length) return <section className="form-panel customer-delivery pending"><h2><span>○</span>{t("delivery.title")}</h2><strong>{t("delivery.pendingTitle")}</strong><p>{t("delivery.pendingBody")}</p></section>;

  return <section className="form-panel customer-delivery ready"><div className="customer-delivery-heading"><div><h2><span>✓</span>{t("delivery.title")}</h2><strong>{t("delivery.readyTitle")}</strong><p>{t("delivery.readyBody")}</p></div><span className="delivery-ready-badge">{t("delivery.readyBadge")}</span></div>
    <ol>{deliveries.data.map((item, index) => <li key={item.id}><div><strong>{item.fileName}</strong><small>{t("delivery.fileMeta", { size: formatSize(item.sizeBytes, locale), date: date.format(new Date(item.publishedAt)) })}</small>{item.note && <p>{item.note}</p>}</div><a className={index === 0 ? "button button-primary" : "button button-secondary"} href={`/api/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(item.id)}/file`}>{t(index === 0 ? "delivery.downloadLatest" : "delivery.download")}</a></li>)}</ol>
  </section>;
}
