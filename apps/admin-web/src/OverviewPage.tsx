import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError, optionService } from "@lifewood/api-client";
import { localizedPath } from "@lifewood/i18n";
import type { AdminCountMetric, ConfigOption, SupportedLocale } from "@lifewood/domain";

function Breakdown({ title, items, options, empty }: { title: string; items: AdminCountMetric[]; options: ConfigOption[]; empty: string }) {
  const labels = useMemo(() => new Map(options.map((option) => [option.id, option.label])), [options]);
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return <section className="overview-panel breakdown-panel">
    <h2>{title}</h2>
    {items.length ? <ul>{items.map((item) => <li key={item.id}>
      <div><span>{labels.get(item.id) ?? item.id}</span><strong>{item.count}</strong></div>
      <span className="metric-track" aria-hidden="true"><i style={{ width: String(Math.max(4, item.count / maximum * 100)) + "%" }} /></span>
    </li>)}</ul> : <p className="overview-empty">{empty}</p>}
  </section>;
}

export function OverviewPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: adminService.getOverview });
  const recent = useQuery({ queryKey: ["admin-projects", "overview-recent"], queryFn: () => adminService.listProjects({ page: 1, pageSize: 6 }) });
  const options = useQuery({ queryKey: ["form-options", locale], queryFn: () => optionService.getFormOptions(locale) });
  const workflowLabels = useMemo(() => new Map((options.data?.workflowStatuses ?? []).map((item) => [item.id, item.label])), [options.data]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  if (overview.isPending || options.isPending) return <main className="content overview-content"><div className="center-state compact" role="status">{t("common.loading")}</div></main>;
  if (overview.isError || options.isError || !overview.data || !options.data) return <main className="content overview-content"><div className="message error" role="alert">{localizedApiError(overview.error ?? options.error, t)}</div></main>;

  const data = overview.data;
  return <main className="content overview-content">
    <section className="overview-stats" aria-label={t("admin.overview.summary")}>
      <div><span>{t("admin.overview.totalProjects")}</span><strong>{data.totalProjects}</strong></div>
      <div className={data.unassignedProjects ? "attention" : ""}><span>{t("admin.overview.unassigned")}</span><strong>{data.unassignedProjects}</strong></div>
      <div><span>{t("admin.overview.activeUsers")}</span><strong>{data.activeUsers}</strong><small>{t("admin.overview.ofUsers", { total: data.totalUsers })}</small></div>
      <div><span>{t("admin.overview.updatedProjects")}</span><strong>{recent.isPending || recent.isError ? "—" : recent.data?.items.length ?? 0}</strong><small>{t("admin.overview.latestRecords")}</small></div>
    </section>
    <div className="overview-grid">
      <Breakdown title={t("admin.overview.workflowDistribution")} items={data.workflowStatuses} options={options.data.workflowStatuses} empty={t("admin.overview.noData")} />
      <Breakdown title={t("admin.overview.priorityDistribution")} items={data.priorities} options={options.data.projectPriorities} empty={t("admin.overview.noData")} />
      <Breakdown title={t("admin.overview.submissionDistribution")} items={data.submissionStatuses} options={options.data.taskStatuses} empty={t("admin.overview.noData")} />
      <section className="overview-panel recent-panel" aria-busy={recent.isPending}>
        <div className="overview-panel-heading"><h2>{t("admin.overview.recentProjects")}</h2><Link to={localizedPath(locale, "/projects")}>{t("admin.overview.viewAll")}</Link></div>
        {recent.isPending && <p className="overview-empty" role="status">{t("common.loading")}</p>}
        {recent.isError && <div className="message error" role="alert">{localizedApiError(recent.error, t)}</div>}
        {recent.data?.items.length ? <ul>{recent.data.items.map((project) => <li key={project.id}>
          <Link to={localizedPath(locale, "/projects?project=" + encodeURIComponent(project.id))}>
            <span><strong>{project.projectName || project.bookTitle || "—"}</strong><small>{project.ownerName} · {project.taskNumber ?? project.id.slice(0, 8)}</small></span>
            <span><em className={"status status-" + project.workflowStatus}>{workflowLabels.get(project.workflowStatus) ?? project.workflowStatus}</em><time dateTime={project.updatedAt}>{formatter.format(new Date(project.updatedAt))}</time></span>
          </Link>
        </li>)}</ul> : !recent.isPending && <p className="overview-empty">{t("admin.overview.noProjects")}</p>}
      </section>
    </div>
  </main>;
}
