import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { ScreenError } from "../components/ScreenError";

export function SubmissionSuccessPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const project = useQuery({ queryKey: ["project", taskId], queryFn: () => projectService.getProject(taskId!, validLocale), enabled: Boolean(taskId) });
  const options = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });

  if (!taskId || !isSupportedLocale(locale)) return null;
  if (project.isPending || options.isPending) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  if (project.isError || options.isError || !project.data || !options.data) return <ScreenError error={project.error ?? options.error} onRetry={() => Promise.all([project.refetch(), options.refetch()])} />;
  if (project.data.status === "draft") return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/review`)} />;
  if (project.data.status !== "submitted") return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />;

  const draft = project.data;
  const status = options.data.taskStatuses.find((item) => item.id === draft.status);
  const fileCount = draft.book.sourceAssets.length + draft.voiceAndReferences.assets.length;
  const submittedAt = new Intl.DateTimeFormat(validLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updatedAt));

  return <div className="submitted-page">
    <section className="submitted-receipt">
      <div className="submitted-mark" aria-hidden="true">✓</div>
      <div className="submitted-heading"><span className={`status-badge tone-${status?.tone ?? "neutral"}`}>{status?.label ?? draft.status}</span><h1>{t("submitted.title")}</h1><p>{t("submitted.body")}</p></div>
      <dl className="submitted-meta">
        <div><dt>{t("taskDetail.taskNumber")}</dt><dd>{draft.taskNumber ?? "—"}</dd></div>
        <div><dt>{t("wizard.fields.projectName")}</dt><dd>{draft.project.projectName}</dd></div>
        <div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{draft.book.title}</dd></div>
        <div><dt>{t("submitted.submittedAt")}</dt><dd>{submittedAt}</dd></div>
        <div><dt>{t("submitted.files")}</dt><dd>{fileCount}</dd></div>
        <div><dt>{t("submitted.links")}</dt><dd>{draft.voiceAndReferences.competitorUrls.length}</dd></div>
      </dl>
      <div className="submitted-actions"><Link className="button button-primary" to={localizedPath(validLocale, `/tasks/${taskId}`)}>{t("submitted.viewRecord")}</Link><Link className="button button-secondary" to={localizedPath(validLocale, "/tasks")}>{t("submitted.backToProjects")}</Link></div>
    </section>
    <aside className="submitted-next"><strong>{t("submitted.nextTitle")}</strong><p>{t("submitted.nextBody")}</p></aside>
  </div>;
}
