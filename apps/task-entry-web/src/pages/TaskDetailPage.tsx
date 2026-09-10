import { safeLinkUrl } from "@lifewood/domain";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { getNarrationEnabled } from "@lifewood/domain";
import { FinalDeliverySection } from "../components/FinalDeliverySection";
import { ReferenceLinks } from "../components/ReferenceLinks";
import { ScreenError } from "../components/ScreenError";

export function TaskDetailPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const task = useQuery({
    queryKey: ["project", taskId, validLocale],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
  });
  const options = useQuery({
    queryKey: ["form-options", validLocale],
    queryFn: () => optionService.getFormOptions(validLocale),
  });
  const needsVoices = task.data ? getNarrationEnabled(task.data.voiceAndReferences.voiceover) === true : false;
  const voices = useQuery({
    queryKey: ["voices", validLocale],
    queryFn: () => optionService.getVoices(validLocale),
    enabled: needsVoices,
  });
  const statusMap = useMemo(
    () =>
      new Map(
        [
          ...(options.data?.taskStatuses ?? []),
          ...(options.data?.workflowStatuses ?? []),
        ].map((item) => [item.id, item]),
      ),
    [options.data],
  );
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (task.isPending || options.isPending || (needsVoices && voices.isPending))
    return (
      <div className="screen-status" aria-busy="true">
        {t("common.loading")}
      </div>
    );
  if (task.isError || options.isError || (needsVoices && voices.isError) || !task.data)
    return <ScreenError error={task.error ?? options.error ?? (needsVoices ? voices.error : undefined)} onRetry={() => Promise.all([task.refetch(), options.refetch(), ...(needsVoices ? [voices.refetch()] : [])])} />;
  if (task.data.status === "draft")
    return (
      <Navigate
        replace
        to={localizedPath(validLocale, `/tasks/${task.data.id}/edit/project`)}
      />
    );

  const statusId = task.data.workflowStatus ?? task.data.status;
  const status = statusMap.get(statusId);
  const optionLabel = (
    items: Array<{ id: string; label: string }>,
    id?: string,
  ) => (id ? (items.find((item) => item.id === id)?.label ?? t("uiDensity.unavailableOption")) : "—");
  const optionLabels = (
    items: Array<{ id: string; label: string }>,
    ids: string[],
  ) =>
    ids.length
      ? ids
          .map((id) => optionLabel(items, id))
          .join(validLocale === "zh-CN" ? "、" : ", ")
      : "—";
  const catalog = options.data!;
  const voiceCatalog = voices.data ?? [];
  const voiceOptions = voiceCatalog.map((voice) => ({
    id: voice.id,
    label: voice.name,
  }));
  const referenceUrls = task.data.voiceAndReferences.competitorUrls
    .flatMap((url) => { const safe = safeLinkUrl(url); return safe ? [safe] : []; });
  const bookCover = task.data.book.sourceAssets.find(
    (asset) => asset.categoryId === "book-cover",
  );
  const date = new Intl.DateTimeFormat(validLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const dateOnly = new Intl.DateTimeFormat(validLocale, {
    dateStyle: "medium",
  });
  return (
    <div className="page detail-page">
      <header className="detail-header">
        <Link
          className="button button-secondary"
          to={localizedPath(validLocale, "/tasks")}
        >
          {t("common.back")}
        </Link>
        <div>
          <span className="folio-kicker">{t("taskDetail.title")}</span>
          <h1>{task.data.project.projectName}</h1>
          <p>{task.data.book.title}</p>
        </div>
        <span className={`status-badge status-${status?.tone ?? "neutral"}`}>
          {status?.label ?? statusId}
        </span>
      </header>
      <div className="detail-layout">
        <aside className="detail-cover">
          {bookCover && (
            <img
              className="detail-cover-image"
              src={bookCover.url}
              alt={t("sourceFiles.coverAlt", { title: task.data.book.title })}
              width="360"
              height="280"
            />
          )}
          <dl>
            {task.data.taskNumber && <div>
              <dt>{t("taskDetail.taskNumber")}</dt>
              <dd translate="no">{task.data.taskNumber}</dd>
            </div>}
            <div>
              <dt>{t("taskDetail.created")}</dt>
              <dd>
                <time dateTime={task.data.createdAt}>
                  {date.format(new Date(task.data.createdAt))}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t("taskDetail.updated")}</dt>
              <dd>
                <time dateTime={task.data.updatedAt}>
                  {date.format(new Date(task.data.updatedAt))}
                </time>
              </dd>
            </div>
          </dl>
        </aside>
        <div className="detail-sections">
          <FinalDeliverySection projectId={task.data.id} locale={validLocale} />
          <section className="form-panel">
            <h2>
              <span>01</span>
              {t("taskDetail.project")}
            </h2>
            <dl className="data-grid">
              <div>
                <dt>{t("wizard.fields.clientName")}</dt>
                <dd>{task.data.project.clientName || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.contactName")}</dt>
                <dd>{task.data.project.contactName || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.email")}</dt>
                <dd>{task.data.project.email || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.phone")}</dt>
                <dd>{task.data.project.phone || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.projectName")}</dt>
                <dd>{task.data.project.projectName || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.brand")}</dt>
                <dd>
                  {optionLabel(catalog.brands, task.data.project.brandId)}
                </dd>
              </div>
              <div>
                <dt>{t("wizard.fields.videoGoal")}</dt>
                <dd>
                  {optionLabel(
                    catalog.videoGoals,
                    task.data.project.videoGoalId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("wizard.fields.deadline")}</dt>
                <dd>
                  {task.data.project.deadline ? (
                    <time dateTime={task.data.project.deadline}>
                      {dateOnly.format(
                        new Date(`${task.data.project.deadline}T00:00:00`),
                      )}
                    </time>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.audiences")}</dt>
                <dd>
                  {optionLabels(
                    catalog.audiences,
                    task.data.project.audienceIds,
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section className="form-panel">
            <h2>
              <span>02</span>
              {t("taskDetail.book")}
            </h2>
            <dl className="data-grid">
              <div>
                <dt>{t("wizard.fields.bookTitle")}</dt>
                <dd>{task.data.book.title || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.subtitle")}</dt>
                <dd>{task.data.book.subtitle || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.authorName")}</dt>
                <dd>{task.data.book.authorName || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.genre")}</dt>
                <dd>{optionLabel(catalog.genres, task.data.book.genreId)}</dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.sellingPoint")}</dt>
                <dd>{task.data.book.sellingPoint || "—"}</dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.synopsis")}</dt>
                <dd>{task.data.book.synopsis || "—"}</dd>
              </div>
              <div>
                <dt>{t("wizard.fields.contentLanguage")}</dt>
                <dd>
                  {optionLabel(
                    catalog.contentLanguages,
                    task.data.book.contentLanguageId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("wizard.fields.duration")}</dt>
                <dd>
                  {task.data.book.customVideoDuration ||
                    optionLabel(
                      catalog.videoDurations,
                      task.data.book.videoDurationId,
                    )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("wizard.fields.platforms")}</dt>
                <dd>
                  {optionLabels(
                    catalog.publishingPlatforms,
                    task.data.book.publishingPlatformIds,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("taskDetail.sourceFiles")}</dt>
                <dd>
                  {task.data.book.sourceAssets.length ? (
                    <ul className="receipt-links">
                      {task.data.book.sourceAssets.map((asset) => (
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
            </dl>
          </section>
          <section className="form-panel">
            <h2>
              <span>03</span>
              {t("taskDetail.creative")}
            </h2>
            <dl className="data-grid">
              <div>
                <dt>{t("creative.fields.visualStyle")}</dt>
                <dd>
                  {optionLabel(
                    catalog.visualStyles,
                    task.data.creative.visualStyleId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("creative.fields.moodTags")}</dt>
                <dd>
                  {optionLabels(
                    catalog.moodTags,
                    task.data.creative.moodTagIds,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("creative.fields.imageTags")}</dt>
                <dd>
                  {optionLabels(
                    [...catalog.imageStyleTags, ...(catalog.legacyImageStyleTags ?? [])],
                    task.data.creative.imageStyleTagIds,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("creative.fields.paceTags")}</dt>
                <dd>
                  {optionLabels(
                    catalog.paceTags,
                    task.data.creative.paceTagIds,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("creative.fields.styleReferences")}</dt>
                <dd>
                  <ReferenceLinks
                    assets={task.data.creative.styleReferenceImages}
                    urls={task.data.creative.styleReferenceImageUrls}
                  />
                </dd>
              </div>
              {task.data.creative.characters.map((character, index) => (
                <div className="data-wide receipt-character" key={character.id}>
                  <dt>{t("taskDetail.character", { index: index + 1 })}</dt>
                  <dd>
                    <>{(character.presetImageUrl ?? character.presetId) && <img src={character.presetImageUrl ?? `/character-presets/${character.presetId}.png`} alt={t("bookIntake.presetImage", { name: character.name })} width="96" height="96" loading="lazy" />}</><strong>{character.name || "—"}</strong> ·{" "}
                    {optionLabel(catalog.roleTypes, character.roleTypeId)}
                    <br />
                    {character.storyRole || "—"}
                    <br />
                    {character.personality || "—"}
                    <br />
                    {character.appearance || "—"}
                    <br />
                    {t("creative.fields.ageRange")}:{" "}
                    {optionLabel(catalog.ageRanges, character.ageRangeId)} ·{" "}
                    {t("creative.fields.gender")}:{" "}
                    {optionLabel(catalog.genders, character.genderId)}
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
          </section>
          <section className="form-panel">
            <h2>
              <span>04</span>
              {t("taskDetail.voice")}
            </h2>
            <dl className="data-grid">
              <div className="data-wide">
                <dt>{t("voice.narration.question")}</dt>
                <dd>{t(getNarrationEnabled(task.data.voiceAndReferences.voiceover) === true ? "voice.narration.required" : getNarrationEnabled(task.data.voiceAndReferences.voiceover) === false ? "voice.narration.notRequired" : "voice.narration.unselected")}</dd>
              </div>
              {getNarrationEnabled(task.data.voiceAndReferences.voiceover) === true && <>
              <div>
                <dt>{t("voice.fields.contentLanguage")}</dt>
                <dd>
                  {optionLabel(
                    catalog.contentLanguages,
                    task.data.voiceAndReferences.voiceover.contentLanguageId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.narrationTone")}</dt>
                <dd>
                  {optionLabel(
                    catalog.narrationTones,
                    task.data.voiceAndReferences.voiceover.narrationToneId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.speechRate")}</dt>
                <dd>
                  {optionLabel(
                    catalog.speechRates,
                    task.data.voiceAndReferences.voiceover.speechRateId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.voiceGender")}</dt>
                <dd>
                  {optionLabel(
                    catalog.voiceGenders,
                    task.data.voiceAndReferences.voiceover.voiceGenderId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.voiceAge")}</dt>
                <dd>
                  {optionLabel(
                    catalog.voiceAges,
                    task.data.voiceAndReferences.voiceover.voiceAgeId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.accent")}</dt>
                <dd>
                  {optionLabel(
                    catalog.accents,
                    task.data.voiceAndReferences.voiceover.accentId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.emotionStyle")}</dt>
                <dd>
                  {optionLabel(
                    catalog.voiceEmotions,
                    task.data.voiceAndReferences.voiceover.emotionStyleId,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("taskDetail.preferredVoice")}</dt>
                <dd>
                  {optionLabel(
                    voiceOptions,
                    task.data.voiceAndReferences.voiceover.preferredVoiceId,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("taskDetail.selectedVoices")}</dt>
                <dd>
                  {optionLabels(
                    voiceOptions,
                    task.data.voiceAndReferences.voiceover.selectedVoiceIds,
                  )}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.pronunciationNotes")}</dt>
                <dd>
                  {task.data.voiceAndReferences.voiceover.pronunciationNotes ||
                    "—"}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.customVoice")}</dt>
                <dd>
                  {task.data.voiceAndReferences.voiceover
                    .customVoiceDescription || "—"}
                </dd>
              </div>
              </>}
              <div className="data-wide">
                <dt>{t("taskDetail.referenceFiles")}</dt>
                <dd>
                  {task.data.voiceAndReferences.assets.length ? (
                    <ul className="receipt-links">
                      {task.data.voiceAndReferences.assets.map((asset) => (
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
          </section>
          <section className="form-panel">
            <h2>
              <span>05</span>
              {t("taskDetail.direction")}
            </h2>
            <dl className="data-grid">
              <div className="data-wide">
                <dt>{t("voice.fields.coreMessage")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection.coreMessage ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.requiredScenes")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection
                    .requiredScenes || "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.authorPreferences")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection
                    .authorPreferences || "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.closingMessage")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection
                    .closingMessage || "—"}
                </dd>
              </div>
              <div>
                <dt>{t("voice.fields.musicMood")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection.musicMood ||
                    "—"}
                </dd>
              </div>
              <div className="data-wide">
                <dt>{t("voice.fields.avoidContent")}</dt>
                <dd>
                  {task.data.voiceAndReferences.creativeDirection
                    .avoidContent || "—"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
