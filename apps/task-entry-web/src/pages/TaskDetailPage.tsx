import { SubmittedMaterials, MaterialsControls, MaterialsLink, MaterialSection } from "../components/SubmittedMaterials";
import { canRetainQueryData, RefreshNotice } from "../components/RefreshNotice";
import "../project-progress.css";
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
import { ProjectCoverImage } from "../components/ProjectCoverImage";
import { ScreenError } from "../components/ScreenError";

const detailGroups = [
  {id:"project",key:"taskDetail.project",path:"M4 7h16v13H4zM8 7V4h8v3M4 12h16M10 12v3h4v-3"},
  {id:"book",key:"taskDetail.book",path:"M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h13M8 4v10"},
  {id:"creative",key:"taskDetail.creative",path:"M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.7h1a4 4 0 0 0 4-4C21 6.4 17 3 12 3ZM8 8h.01M13 7h.01M17 10h.01M7 13h.01"},
  {id:"voice",key:"taskDetail.voice",path:"M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6"},
  {id:"direction",key:"taskDetail.direction",path:"M4 4h16v13H9l-5 4V4ZM8 8h8M8 12h5"},
] as const;
function DetailGroupIcon({path}:{path:string}) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}

export function TaskDetailPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const task = useQuery({
    queryKey: ["project", taskId, validLocale],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
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
  if ((task.isError && (!task.data || !canRetainQueryData(task.error))) || (options.isError && (!options.data || !canRetainQueryData(options.error))) || (needsVoices && voices.isError && (!voices.data || !canRetainQueryData(voices.error))) || !task.data)
    return <ScreenError error={task.error ?? options.error ?? (needsVoices ? voices.error : undefined)} onRetry={() => Promise.all([task.refetch(), options.refetch(), ...(needsVoices ? [voices.refetch()] : [])])} />;
  if (task.data.status === "draft" && task.data.canEdit !== false)
    return (
      <Navigate
        replace
        to={localizedPath(validLocale, `/tasks/${task.data.id}/edit/project`)}
      />
    );

  const statusId = task.data.status === "draft" && task.data.workflowStatus !== "awaiting_customer" ? "draft" : task.data.workflowStatus ?? task.data.status;
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
      <RefreshNotice error={task.error ?? options.error ?? (needsVoices ? voices.error : null)} onRetry={() => Promise.all([task.refetch(), options.refetch(), ...(needsVoices ? [voices.refetch()] : [])])}/>
      <header className="detail-header">
        <Link
          className="button button-quiet detail-back"
          to={localizedPath(validLocale, "/tasks")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m11 5-7 7 7 7M4 12h16"/></svg>{t("common.back")}
        </Link>
        <div>
          <span className="folio-kicker sr-only">{t("taskDetail.title")}</span>
          <h1>{task.data.project.projectName}</h1>
          <p>{task.data.book.title}</p>
        </div>

      </header>
      <section className="project-progress-summary" aria-label={t("projectProgress.title")}>
        <div className="project-progress-state">
          <span className="project-progress-label">{t("projectProgress.title")}</span>
          <span className={`status-badge status-${status?.tone ?? "neutral"}`}>{status?.label ?? t("uiDensity.unavailableOption")}</span>
          <p>{t(`projectProgress.${statusId === "draft" ? "draft" : statusId === "awaiting_customer" ? "returned" : statusId === "completed" ? "completed" : statusId === "closed" ? "closed" : statusId === "in_production" ? "production" : "waiting"}`)}</p>
          <a className="button button-quiet" href="#submitted-materials">{t("projectProgress.viewMaterials")}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"/></svg></a>
        </div>
        {task.data.status !== "draft" && <FinalDeliverySection projectId={task.data.id} locale={validLocale} />}
      </section>
      <SubmittedMaterials key={task.data.id} ids={[...detailGroups.map(group => group.id), ...task.data.creative.characters.map(character => `character-${character.id}`)]}>
        <aside className="detail-cover">
          {bookCover && <a className="detail-cover-preview" href={safeLinkUrl(bookCover.url,true)} target="_blank" rel="noreferrer" aria-label={t("taskDetail.previewCover")}>
            <ProjectCoverImage className="detail-cover-image" coverUrl={bookCover.url} coverAlt={t("sourceFiles.coverAlt",{title:task.data.book.title})} placeholderAlt={t("taskDetail.previewCover")} width={200} height={144}/>
            <span>{t("taskDetail.previewCover")}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M10 4H4v16h16v-6"/></svg></span>
          </a>}
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
              <dt>{t(task.data.status === "draft" ? "tasks.columns.updated" : "taskDetail.updated")}</dt>
              <dd>
                <time dateTime={task.data.updatedAt}>
                  {date.format(new Date(task.data.updatedAt))}
                </time>
              </dd>
            </div>
          </dl>
          <nav className="detail-contents" aria-label={t("taskDetail.contents")}>
            {detailGroups.map(group=><MaterialsLink key={group.id} id={group.id}><DetailGroupIcon path={group.path}/><span>{t(group.key)}</span></MaterialsLink>)}
          </nav>
          <MaterialsControls />
        </aside>
        <div className="detail-sections">
          <MaterialSection id="project" title={<><DetailGroupIcon path={detailGroups[0].path}/>{t("taskDetail.project")}</>}>
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
          </MaterialSection>
          <MaterialSection id="book" title={<><DetailGroupIcon path={detailGroups[1].path}/>{t("taskDetail.book")}</>}>
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
          </MaterialSection>
          <MaterialSection id="creative" title={<><DetailGroupIcon path={detailGroups[2].path}/>{t("taskDetail.creative")}</>}>
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
                  <dt className="sr-only">{t("taskDetail.character", { index: index + 1 })}</dt>
                  <dd>
                    <MaterialSection character id={`character-${character.id}`} title={<><span>{character.name || t("taskDetail.character", { index: index + 1 })}</span><small>{optionLabel(catalog.roleTypes, character.roleTypeId)}</small></>}>
                      {(character.presetImageUrl ?? character.presetId) && <img className="receipt-character-image" src={character.presetImageUrl ?? `/character-presets/${character.presetId}.png`} alt={t("bookIntake.presetImage", { name: character.name })} width="96" height="96" loading="eager" />}
                      <dl className="data-grid">
                        <div className="data-wide"><dt>{t("creative.fields.storyRole")}</dt><dd>{character.storyRole || "—"}</dd></div>
                        <div className="data-wide"><dt>{t("creative.fields.personality")}</dt><dd>{character.personality || "—"}</dd></div>
                        <div className="data-wide"><dt>{t("creative.fields.appearance")}</dt><dd>{character.appearance || "—"}</dd></div>
                        <div><dt>{t("creative.fields.ageRange")}</dt><dd>{optionLabel(catalog.ageRanges, character.ageRangeId)}</dd></div>
                        <div><dt>{t("creative.fields.gender")}</dt><dd>{optionLabel(catalog.genders, character.genderId)}</dd></div>
                        <div><dt>{t("creative.fields.clothing")}</dt><dd>{character.clothing || "—"}</dd></div>
                        <div><dt>{t("creative.fields.emotion")}</dt><dd>{character.emotion || "—"}</dd></div>
                        <div className="data-wide"><dt>{t("creative.fields.voiceHint")}</dt><dd>{character.voiceHint || "—"}</dd></div>
                        {(character.referenceImages?.length || character.referenceImageUrls.length) ? <div className="data-wide"><dt>{t("creative.fields.referenceImages")}</dt><dd><ReferenceLinks assets={character.referenceImages} urls={character.referenceImageUrls} empty={false} /></dd></div> : null}
                      </dl>
                    </MaterialSection>
                  </dd>
                </div>
              ))}
            </dl>
          </MaterialSection>
          <MaterialSection id="voice" title={<><DetailGroupIcon path={detailGroups[3].path}/>{t("taskDetail.voice")}</>}>
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
          </MaterialSection>
          <MaterialSection id="direction" title={<><DetailGroupIcon path={detailGroups[4].path}/>{t("taskDetail.direction")}</>}>
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
          </MaterialSection>
        </div>
      </SubmittedMaterials>
    </div>
  );
}
