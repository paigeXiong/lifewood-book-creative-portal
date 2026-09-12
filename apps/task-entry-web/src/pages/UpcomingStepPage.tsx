import { safeLinkUrl } from "@lifewood/domain";
import { RevisionNavigation, RevisionLink, ReviewSection, useRevisionPrevious } from "../revision-navigation";
import { useProjectSubmission } from "../useProjectSubmission";
import { useContext, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  localizedApiError,
  optionService,
  projectService,
} from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { getNarrationEnabled } from "@lifewood/domain";
import { StepProgress } from "../components/StepProgress";
import { getHighestReachableStep } from "../workflow-progress";
import { ReferenceLinks } from "../components/ReferenceLinks";
import { ScreenError } from "../components/ScreenError";
import { ProjectCoverImage } from "../components/ProjectCoverImage";
import { isCharactersComplete, isStyleComplete } from "./creativeFormSchema";
import { isReferencesStepComplete, isVoicePreferencesComplete } from "./voiceFormSchema";
import { isProjectStepComplete, isProjectBasicsComplete } from "./projectFormSchema";

export function UpcomingStepPage() {
  const { t } = useTranslation();
  const allowed = useContext(RevisionNavigation);
  const previous = useRevisionPrevious();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const project = useQuery({
    queryKey: ["project", taskId],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
  });
  const options = useQuery({
    queryKey: ["form-options", validLocale],
    queryFn: () => optionService.getFormOptions(validLocale),
  });
  const needsVoices = project.data ? getNarrationEnabled(project.data.voiceAndReferences.voiceover) === true : false;
  const voices = useQuery({
    queryKey: ["voices", validLocale],
    queryFn: () => optionService.getVoices(validLocale),
    enabled: needsVoices,
  });
  const receiptTask = useRef<string | undefined>(undefined);
  const submit = useProjectSubmission(taskId, validLocale, project.data, submitted => {
    receiptTask.current = submitted.id;
    const cached = queryClient.getQueryData<typeof submitted>(["project", submitted.id]);
    if (!cached || cached.version <= submitted.version) queryClient.setQueryData(["project", submitted.id], submitted);
    else void queryClient.invalidateQueries({ queryKey: ["project", submitted.id] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["project-stats"] });
    navigate(localizedPath(validLocale, `/tasks/${submitted.id}/submitted`), { replace: true });
  });
  const validationIssues = submit.validationIssues;
  if (!isSupportedLocale(locale) || !taskId) return null;
  if (project.isPending || options.isPending || (needsVoices && voices.isPending))
    return (
      <div className="screen-status" role="status" aria-busy="true">
        {t("common.loading")}
      </div>
    );
  if (
    project.isError ||
    options.isError ||
    (needsVoices && voices.isError) ||
    !project.data ||
    !options.data
  )
    return <ScreenError error={project.error ?? options.error ?? (needsVoices ? voices.error : undefined)} onRetry={() => Promise.all([project.refetch(), options.refetch(), ...(needsVoices ? [voices.refetch()] : [])])} />;
  if (project.data.status !== "draft")
    return <Navigate replace to={localizedPath(locale, `/tasks/${taskId}${receiptTask.current === taskId ? "/submitted" : ""}`)} />;
  if (!allowed && (!isProjectStepComplete(project.data)))
    return (
      <Navigate
        replace
        to={localizedPath(locale, `/tasks/${taskId}/edit/project`)}
      />
    );
  if (!allowed && (!isCharactersComplete(project.data.creative)))
    return (
      <Navigate
        replace
        to={localizedPath(locale, `/tasks/${taskId}/edit/characters`)}
      />
    );
  if (!allowed && (!isVoicePreferencesComplete(project.data.voiceAndReferences)))
    return (
      <Navigate
        replace
        to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)}
      />
    );
  if (!allowed && (!isStyleComplete(project.data.creative)))
    return (
      <Navigate
        replace
        to={localizedPath(locale, `/tasks/${taskId}/edit/style`)}
      />
    );
  if (!allowed && (!isProjectBasicsComplete(project.data.project) || !isReferencesStepComplete(project.data.voiceAndReferences)))
    return (
      <Navigate
        replace
        to={localizedPath(locale, `/tasks/${taskId}/edit/references`)}
      />
    );

  const draft = project.data;
  const catalog = options.data;
  const label = (items: { id: string; label: string }[], id?: string) =>
    items.find((item) => item.id === id)?.label ?? "—";
  const labels = (items: { id: string; label: string }[], ids: string[]) =>
    ids.map((id) => label(items, id)).join(" · ") || "—";
  const voiceOptions = (voices.data ?? []).map((voice) => ({
    id: voice.id,
    label: voice.name,
  }));
  const referenceUrls = draft.voiceAndReferences.competitorUrls
    .flatMap((url) => { const safe = safeLinkUrl(url); return safe ? [safe] : []; });
  const bookCover = draft.book.sourceAssets.find(
    (asset) => asset.categoryId === "book-cover",
  );
  const dateOnly = new Intl.DateTimeFormat(validLocale, {
    dateStyle: "medium",
  });
  const conflict =
    submit.error instanceof ApiError &&
    submit.error.details.code === "project.version_conflict";
  const validationGroups = [
    {
      keys: ["book."],
      label: t("wizard.steps.project"),
      path: "project",
    },
    {
      keys: ["creative.characters"],
      label: t("wizard.steps.characters"),
      path: "characters",
    },
    {
      keys: ["voiceAndReferences.voiceover"],
      label: t("wizard.steps.voice"),
      path: "voice",
    },
    {
      keys: ["creative.visualStyleId", "creative.moodTagIds", "creative.imageStyleTagIds", "creative.paceTagIds", "creative.styleReference"],
      label: t("wizard.steps.style"),
      path: "style",
    },
    {
      keys: ["project.", "voiceAndReferences.assets", "voiceAndReferences.competitorUrls", "voiceAndReferences.creativeDirection"],
      label: t("wizard.steps.references"),
      path: "references",
    },
  ]
    .map((group) => ({
      ...group,
      count: validationIssues.filter((issue) =>
        group.keys.some((key) => issue.field.startsWith(key)),
      ).length,
    }))
    .filter((group) => group.count > 0);

  return (
    <div className="wizard-page review-page">
      <h1 className="sr-only">{t("wizard.pageTitles.review")}</h1>
      <StepProgress current={6} highestReachable={getHighestReachableStep(project.data)} busy={submit.isPending} />
      {submit.isError && (
        <div className="inline-error review-error" role="alert">
          {submit.outcome === "unknown" ? t("submissionRecovery.unknown") : submit.outcome === "retry" ? t("submissionRecovery.retryHint") : localizedApiError(submit.error, t)}
          {conflict && (
            <button
              className="button button-secondary"
              type="button"
              disabled={submit.isPending}
              onClick={() => void project.refetch().then(result => { if (!result.isError) submit.reset(); })}
            >
              {t("common.reload")}
            </button>
          )}
        </div>
      )}
      {validationIssues.length > 0 && (
        <section className="validation-summary" role="alert">
          <div>
            <strong>{t("review.validationTitle")}</strong>
            <p>{t("review.validationBody")}</p>
          </div>
          <ul>
            {validationGroups.map((group) => (
              <li key={group.path}>
                <RevisionLink hideWhenLocked viewTransition
                  to={localizedPath(
                    validLocale,
                    `/tasks/${taskId}/edit/${group.path}`,
                  )}
                >
                  {group.label}
                  <span>
                    {t("review.validationCount", { count: group.count })}
                  </span>
                </RevisionLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="review-layout" inert={submit.isPending}>
        <div className="review-main-stack">
          <ReviewSection units={["references"]} className="">
            <div className="review-section-heading">
              <h2>
                <span>1</span>
                {t("taskDetail.project")}
              </h2>
              <RevisionLink hideWhenLocked viewTransition to={localizedPath(locale, `/tasks/${taskId}/edit/references`)}>
                {t("review.edit")}
              </RevisionLink>
            </div>
            <dl className="data-grid">
              <div>
                <dt>{t("wizard.fields.projectName")}</dt>
                <dd>{draft.project.projectName}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.clientName")}</dt>
                <dd>{draft.project.clientName}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.contactName")}</dt>
                <dd>{draft.project.contactName}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.email")}</dt>
                <dd>{draft.project.email}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.phone")}</dt>
                <dd>{draft.project.phone || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.brand")}</dt>
                <dd>{label(catalog.brands, draft.project.brandId)}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.videoGoal")}</dt>
                <dd>{label(catalog.videoGoals, draft.project.videoGoalId)}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.deadline")}</dt>
                <dd>
                  {draft.project.deadline ? (
                    <time dateTime={draft.project.deadline}>
                      {dateOnly.format(
                        new Date(`${draft.project.deadline}T00:00:00`),
                      )}
                    </time>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.audiences")}</dt>
                <dd>{labels(catalog.audiences, draft.project.audienceIds)}</dd>
              </div>
            </dl>
          </ReviewSection>
          <ReviewSection units={["project"]} className="">
            <div className="review-section-heading">
              <h2>
                <span>2</span>
                {t("taskDetail.book")}
              </h2>
              <RevisionLink hideWhenLocked viewTransition to={localizedPath(locale, `/tasks/${taskId}/edit/project`)}>
                {t("review.edit")}
              </RevisionLink>
            </div>
            <ProjectCoverImage coverUrl={bookCover?.url} coverAlt={t("sourceFiles.coverAlt", { title: draft.book.title })} placeholderAlt={t("sourceFiles.coverPendingAlt")} className="review-cover" width={130} height={170} />
            <dl className="data-grid">
              <div>
                <dt>{t("wizard.fields.bookTitle")}</dt>
                <dd>{draft.book.title}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.subtitle")}</dt>
                <dd>{draft.book.subtitle || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.authorName")}</dt>
                <dd>{draft.book.authorName}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.genre")}</dt>
                <dd>{label(catalog.genres, draft.book.genreId)}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.contentLanguage")}</dt>
                <dd>
                  {label(
                    catalog.contentLanguages,
                    draft.book.contentLanguageId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("wizard.fields.duration")}</dt>
                <dd>
                  {draft.book.customVideoDuration ||
                    label(catalog.videoDurations, draft.book.videoDurationId)}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.platforms")}</dt>
                <dd>
                  {labels(
                    catalog.publishingPlatforms,
                    draft.book.publishingPlatformIds,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.sellingPoint")}</dt>
                <dd>{draft.book.sellingPoint}</dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.synopsis")}</dt>
                <dd>{draft.book.synopsis}</dd>
              </div>
              <div className="data-wide">
                <dt>{t("taskDetail.sourceFiles")}</dt>
                <dd>
                  <ul className="receipt-links">
                    {draft.book.sourceAssets.map((asset) => (
                      <li key={asset.id}>
                        <a href={safeLinkUrl(asset.url, true)}>{asset.fileName}</a>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </ReviewSection>
          <ReviewSection units={["characters", "style"]} className="">
            <div className="review-section-heading">
              <h2>
                <span>3</span>
                {t("taskDetail.creative")}
              </h2>
              <RevisionLink hideWhenLocked viewTransition
                to={localizedPath(locale, `/tasks/${taskId}/edit/style`)}
              >
                {t("review.edit")}
              </RevisionLink>
              <RevisionLink hideWhenLocked to={localizedPath(locale, `/tasks/${taskId}/edit/characters`)}>{t("wizard.steps.characters")}</RevisionLink>
            </div>
            <dl className="data-grid">
              <div>
                <dt>{t("creative.fields.visualStyle")}</dt>
                <dd>
                  {label(catalog.visualStyles, draft.creative.visualStyleId)}
                </dd>
              </div>
              <div>
                <dt>{t("creative.fields.moodTags")}</dt>
                <dd>{labels(catalog.moodTags, draft.creative.moodTagIds)}</dd>
              </div>
              <div>
                <dt>{t("creative.fields.imageTags")}</dt>
                <dd>
                  {labels(
                    [...catalog.imageStyleTags, ...(catalog.legacyImageStyleTags ?? [])],
                    draft.creative.imageStyleTagIds,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("creative.fields.paceTags")}</dt>
                <dd>{labels(catalog.paceTags, draft.creative.paceTagIds)}</dd>
              </div>
              <div className="data-wide">
                <dt>{t("creative.fields.styleReferences")}</dt>
                <dd>
                  <ReferenceLinks
                    assets={draft.creative.styleReferenceImages}
                    urls={draft.creative.styleReferenceImageUrls}
                  />
                </dd>
              </div>
              {draft.creative.characters.map((character, index) => (
                <div className="data-wide receipt-character" key={character.id}>
                  <dt>{t("taskDetail.character", { index: index + 1 })}</dt>
                  <dd>
                    <strong>{character.name}</strong> ·{" "}
                    {label(catalog.roleTypes, character.roleTypeId)}
                    <br />
                    {character.storyRole}
                    <br />
                    {character.personality}
                    <br />
                    {character.appearance}
                    <br />
                    {t("creative.fields.ageRange")}:{" "}
                    {label(catalog.ageRanges, character.ageRangeId)} ·{" "}
                    {t("creative.fields.gender")}:{" "}
                    {label(catalog.genders, character.genderId)}
                    <br />
                    {t("creative.fields.clothing")}: {character.clothing || "—"}
                    <br />
                    {t("creative.fields.emotion")}: {character.emotion || "—"}
                    <br />
                    {t("creative.fields.voiceHint")}:{" "}
                    {character.voiceHint || "—"}
                    {character.referenceImages?.length ||
                    character.referenceImageUrls.length ? (
                      <>
                        <br />
                        {t("creative.fields.referenceImages")}:{" "}
                        <ReferenceLinks
                          assets={character.referenceImages}
                          urls={character.referenceImageUrls}
                          empty={false}
                        />
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </ReviewSection>
          <ReviewSection units={["voice", "references"]} className="">
            <div className="review-section-heading">
              <h2>
                <span>4</span>
                {t("taskDetail.voice")}
              </h2>
              <RevisionLink hideWhenLocked viewTransition to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)}>
                {t("review.edit")}
              </RevisionLink>
            </div>
            <dl className="data-grid">
              <div className="data-wide">
                <dt>{t("voice.narration.question")}</dt>
                <dd>{t(getNarrationEnabled(draft.voiceAndReferences.voiceover) === true ? "voice.narration.required" : getNarrationEnabled(draft.voiceAndReferences.voiceover) === false ? "voice.narration.notRequired" : "voice.narration.unselected")}</dd>
              </div>
              {getNarrationEnabled(draft.voiceAndReferences.voiceover) === true && <>
              <div>
                <dt>{t("voice.fields.contentLanguage")}</dt>
                <dd>
                  {label(
                    catalog.contentLanguages,
                    draft.voiceAndReferences.voiceover.contentLanguageId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.narrationTone")}</dt>
                <dd>
                  {label(
                    catalog.narrationTones,
                    draft.voiceAndReferences.voiceover.narrationToneId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.speechRate")}</dt>
                <dd>
                  {label(
                    catalog.speechRates,
                    draft.voiceAndReferences.voiceover.speechRateId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.voiceGender")}</dt>
                <dd>
                  {label(
                    catalog.voiceGenders,
                    draft.voiceAndReferences.voiceover.voiceGenderId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.voiceAge")}</dt>
                <dd>
                  {label(
                    catalog.voiceAges,
                    draft.voiceAndReferences.voiceover.voiceAgeId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.accent")}</dt>
                <dd>
                  {label(
                    catalog.accents,
                    draft.voiceAndReferences.voiceover.accentId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.emotionStyle")}</dt>
                <dd>
                  {label(
                    catalog.voiceEmotions,
                    draft.voiceAndReferences.voiceover.emotionStyleId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("taskDetail.preferredVoice")}</dt>
                <dd>
                  {label(
                    voiceOptions,
                    draft.voiceAndReferences.voiceover.preferredVoiceId,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("taskDetail.selectedVoices")}</dt>
                <dd>
                  {labels(
                    voiceOptions,
                    draft.voiceAndReferences.voiceover.selectedVoiceIds,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.pronunciationNotes")}</dt>
                <dd>
                  {draft.voiceAndReferences.voiceover.pronunciationNotes || "—"}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.customVoice")}</dt>
                <dd>
                  {draft.voiceAndReferences.voiceover.customVoiceDescription ||
                    "—"}
                </dd>
              </div>
              </>}
              <div className="data-wide">
                <dt>{t("taskDetail.referenceFiles")}</dt>
                <dd>
                  {draft.voiceAndReferences.assets.length ? (
                    <ul className="receipt-links">
                      {draft.voiceAndReferences.assets.map((asset) => (
                        <li key={asset.id}>
                          <a href={safeLinkUrl(asset.url, true)}>{asset.fileName}</a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("taskDetail.referenceLinks")}</dt>
                <dd>
                  {referenceUrls.length ? (
                    <ul className="receipt-links">
                      {referenceUrls.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </ReviewSection>
          <ReviewSection units={["references"]} className="review-wide">
            <div className="review-section-heading">
              <h2>
                <span>5</span>
                {t("taskDetail.direction")}
              </h2>
              <RevisionLink hideWhenLocked viewTransition to={localizedPath(locale, `/tasks/${taskId}/edit/references`)}>
                {t("review.edit")}
              </RevisionLink>
            </div>
            <dl className="data-grid">
              <div className="data-wide">
                <dt>{t("voice.fields.coreMessage")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection.coreMessage}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.requiredScenes")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection.requiredScenes ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.authorPreferences")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection
                    .authorPreferences || "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.closingMessage")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection.closingMessage ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.musicMood")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection.musicMood || "—"}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.avoidContent")}</dt>
                <dd>
                  {draft.voiceAndReferences.creativeDirection.avoidContent ||
                    "—"}
                </dd>
              </div>
            </dl>
          </ReviewSection>
        </div>
        <aside className="review-summary-rail">
          <div className="folio-card">
            <h3 className="summary-title">{t("wizard.summary.title")}</h3>
            <ProjectCoverImage coverUrl={bookCover?.url} coverAlt={t("sourceFiles.coverAlt", { title: draft.book.title })} placeholderAlt={t("sourceFiles.coverPendingAlt")} className="summary-cover" width={240} height={180} />
            <dl className="summary-meta">
              <div>
                <dt>{t("wizard.fields.bookTitle")}</dt>
                <dd>{draft.book.title}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.authorName")}</dt>
                <dd>{draft.book.authorName}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.genre")}</dt>
                <dd>{label(catalog.genres, draft.book.genreId)}</dd>
              </div>
              <div>
                <dt>{t("wizard.summary.status")}</dt>
                <dd>
                  <span className="status-badge">
                    {allowed ? t("clientUx.returnedStatus") : label(catalog.taskStatuses, draft.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{t("wizard.summary.created")}</dt>
                <dd>{dateOnly.format(new Date(draft.createdAt))}</dd>
              </div>
            </dl>
          </div>
          <div className="check-card">
            <h3>{t("wizard.summary.checklist")}</h3>
            <ul>
              <li className="done">
                <span>✓</span>
                {t("wizard.summary.client")}
              </li>
              <li className="done">
                <span>✓</span>
                {t("wizard.summary.book")}
              </li>
              <li className="done">
                <span>✓</span>
                {t("creative.sections.characters")}
              </li>
              <li className="done">
                <span>✓</span>
                {t("creative.sections.style")}
              </li>
              <li className="done">
                <span>✓</span>
                {t("voice.sections.settings")}
              </li>
            </ul>
          </div>
          <div className="submit-notice">
            <div>
              <strong>{t("review.noticeTitle")}</strong>
              <p>{t(allowed ? "clientUx.revisionReviewHint" : "review.noticeBody")}</p>
            </div>
          </div>
        </aside>
      </div>
      <div className="sticky-actions">
        <RevisionLink hideWhenLocked viewTransition
          className="button button-secondary"
          aria-disabled={submit.isPending || undefined}
          onClick={event => { if (submit.isPending) event.preventDefault(); }}
          to={localizedPath(locale, `/tasks/${taskId}/edit/${previous ?? "references"}`)}
        >
          {previous ? t("clientUx.backTo", {unit: t("wizard.steps."+previous)}) : t("wizard.actions.backReferences")}
        </RevisionLink>

        <div>
          <button
            className="button button-primary"
            type="button"
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.phase === "checking" ? t("submissionRecovery.checking") : submit.isPending ? t("review.submitting") : submit.outcome === "unknown" ? t("submissionRecovery.check") : submit.outcome === "retry" ? t("submissionRecovery.retry") : t(allowed ? "clientUx.resubmit" : "review.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
