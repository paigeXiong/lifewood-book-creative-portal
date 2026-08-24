import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { StepProgress } from "../components/StepProgress";
import { isCreativeComplete } from "./creativeFormSchema";
import { isVoiceStepComplete } from "./voiceFormSchema";
import { isProjectStepComplete } from "./projectFormSchema";

export function UpcomingStepPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef(crypto.randomUUID().replaceAll("-", ""));
  const [validationIssues, setValidationIssues] = useState<Array<{ field: string; code: string; messageKey?: string }>>([]);
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const project = useQuery({ queryKey: ["project", taskId], queryFn: () => projectService.getProject(taskId!, validLocale), enabled: Boolean(taskId) });
  const options = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const voices = useQuery({ queryKey: ["voices", validLocale], queryFn: () => optionService.getVoices(validLocale) });
  const submit = useMutation({
    mutationFn: async () => {
      const validation = await projectService.validateProject(taskId!, project.data!.version, validLocale);
      if (!validation.valid) return { validation };
      const submitted = await projectService.submitProject(taskId!, project.data!.version, idempotencyKey.current, validLocale);
      return { validation, submitted };
    },
    onMutate: () => setValidationIssues([]),
    onSuccess: ({ validation, submitted }) => {
      if (!submitted) { setValidationIssues(validation.fieldErrors); return; }
      setValidationIssues([]);
      queryClient.setQueryData(["project", taskId], submitted);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(localizedPath(validLocale, `/tasks/${submitted.id}/submitted`), { replace: true });
    },
  });
  if (!isSupportedLocale(locale) || !taskId) return null;
  if (project.isPending || options.isPending || voices.isPending) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  if (project.isError || options.isError || voices.isError || !project.data || !options.data) return <div className="screen-status" role="alert">{localizedApiError(project.error ?? options.error ?? voices.error, t)}</div>;
  if (project.data.status !== "draft") return <Navigate replace to={localizedPath(locale, `/tasks/${taskId}`)} />;
  if (!isProjectStepComplete(project.data)) return <Navigate replace to={localizedPath(locale, `/tasks/${taskId}/edit/project`)} />;
  if (!isCreativeComplete(project.data.creative)) return <Navigate replace to={localizedPath(locale, `/tasks/${taskId}/edit/characters`)} />;
  if (!isVoiceStepComplete(project.data.voiceAndReferences)) return <Navigate replace to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)} />;

  const draft = project.data;
  const catalog = options.data;
  const label = (items: { id: string; label: string }[], id?: string) => items.find((item) => item.id === id)?.label ?? "—";
  const labels = (items: { id: string; label: string }[], ids: string[]) => ids.map((id) => label(items, id)).join(" · ") || "—";
  const voiceOptions = (voices.data ?? []).map((voice) => ({ id: voice.id, label: voice.name }));
  const referenceUrls = draft.voiceAndReferences.competitorUrls.map((url) => url.trim()).filter(Boolean);
  const bookCover = draft.book.sourceAssets.find((asset) => asset.categoryId === "book-cover");
  const dateOnly = new Intl.DateTimeFormat(validLocale, { dateStyle: "medium" });
  const conflict = submit.error instanceof ApiError && submit.error.details.code === "project.version_conflict";
  const validationGroups = [
    { keys: ["project.", "book."], label: t("wizard.steps.project"), path: "project" },
    { keys: ["creative."], label: t("wizard.steps.characters"), path: "characters" },
    { keys: ["voiceAndReferences."], label: t("wizard.steps.voice"), path: "voice" },
  ].map((group) => ({ ...group, count: validationIssues.filter((issue) => group.keys.some((key) => issue.field.startsWith(key))).length })).filter((group) => group.count > 0);

  return <div className="wizard-page review-page">
    <StepProgress current={4} />
    <div className="wizard-heading"><div><h1>{t("wizard.steps.review")}</h1><p>{t("review.intro")}</p></div></div>
    {submit.isError && <div className="inline-error review-error" role="alert">{localizedApiError(submit.error, t)}{conflict && <button className="button button-secondary" type="button" onClick={() => void project.refetch()}>{t("common.reload")}</button>}</div>}
    {validationIssues.length > 0 && <section className="validation-summary" role="alert"><div><strong>{t("review.validationTitle")}</strong><p>{t("review.validationBody")}</p></div><ul>{validationGroups.map((group) => <li key={group.path}><Link to={localizedPath(validLocale, `/tasks/${taskId}/edit/${group.path}`)}>{group.label}<span>{t("review.validationCount", { count: group.count })}</span></Link></li>)}</ul></section>}
    <div className="review-grid">
      <section className="form-panel review-section">
        <div className="review-section-heading"><h2><span>1</span>{t("taskDetail.project")}</h2><Link to={localizedPath(locale, `/tasks/${taskId}/edit/project`)}>{t("review.edit")}</Link></div>
        <dl className="data-grid"><div><dt>{t("wizard.fields.projectName")}</dt><dd>{draft.project.projectName}</dd></div><div><dt>{t("wizard.fields.clientName")}</dt><dd>{draft.project.clientName}</dd></div><div><dt>{t("wizard.fields.contactName")}</dt><dd>{draft.project.contactName}</dd></div><div><dt>{t("wizard.fields.email")}</dt><dd>{draft.project.email}</dd></div><div><dt>{t("wizard.fields.phone")}</dt><dd>{draft.project.phone || "—"}</dd></div><div><dt>{t("wizard.fields.brand")}</dt><dd>{label(catalog.brands, draft.project.brandId)}</dd></div><div><dt>{t("wizard.fields.videoGoal")}</dt><dd>{label(catalog.videoGoals, draft.project.videoGoalId)}</dd></div><div><dt>{t("wizard.fields.deadline")}</dt><dd>{draft.project.deadline ? <time dateTime={draft.project.deadline}>{dateOnly.format(new Date(`${draft.project.deadline}T00:00:00`))}</time> : "—"}</dd></div><div className="data-wide"><dt>{t("wizard.fields.audiences")}</dt><dd>{labels(catalog.audiences, draft.project.audienceIds)}</dd></div></dl>
      </section>
      <section className="form-panel review-section">
        <div className="review-section-heading"><h2><span>2</span>{t("taskDetail.book")}</h2><Link to={localizedPath(locale, `/tasks/${taskId}/edit/project`)}>{t("review.edit")}</Link></div>
        {bookCover && <img className="review-cover" src={bookCover.url} alt={t("sourceFiles.coverAlt", { title: draft.book.title })} />}
        <dl className="data-grid"><div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{draft.book.title}</dd></div><div><dt>{t("wizard.fields.subtitle")}</dt><dd>{draft.book.subtitle || "—"}</dd></div><div><dt>{t("wizard.fields.authorName")}</dt><dd>{draft.book.authorName}</dd></div><div><dt>{t("wizard.fields.genre")}</dt><dd>{label(catalog.genres, draft.book.genreId)}</dd></div><div><dt>{t("wizard.fields.contentLanguage")}</dt><dd>{label(catalog.contentLanguages, draft.book.contentLanguageId)}</dd></div><div><dt>{t("wizard.fields.duration")}</dt><dd>{label(catalog.videoDurations, draft.book.videoDurationId)}</dd></div><div className="data-wide"><dt>{t("wizard.fields.platforms")}</dt><dd>{labels(catalog.publishingPlatforms, draft.book.publishingPlatformIds)}</dd></div><div className="data-wide"><dt>{t("wizard.fields.sellingPoint")}</dt><dd>{draft.book.sellingPoint}</dd></div><div className="data-wide"><dt>{t("wizard.fields.synopsis")}</dt><dd>{draft.book.synopsis}</dd></div><div className="data-wide"><dt>{t("taskDetail.sourceFiles")}</dt><dd><ul className="receipt-links">{draft.book.sourceAssets.map((asset) => <li key={asset.id}><a href={asset.url}>{asset.fileName}</a></li>)}</ul></dd></div></dl>
      </section>
      <section className="form-panel review-section">
        <div className="review-section-heading"><h2><span>3</span>{t("taskDetail.creative")}</h2><Link to={localizedPath(locale, `/tasks/${taskId}/edit/characters`)}>{t("review.edit")}</Link></div>
        <dl className="data-grid"><div><dt>{t("creative.fields.visualStyle")}</dt><dd>{label(catalog.visualStyles, draft.creative.visualStyleId)}</dd></div><div><dt>{t("creative.fields.moodTags")}</dt><dd>{labels(catalog.moodTags, draft.creative.moodTagIds)}</dd></div><div><dt>{t("creative.fields.imageTags")}</dt><dd>{labels(catalog.imageStyleTags, draft.creative.imageStyleTagIds)}</dd></div><div><dt>{t("creative.fields.paceTags")}</dt><dd>{labels(catalog.paceTags, draft.creative.paceTagIds)}</dd></div>{draft.creative.characters.map((character, index) => <div className="data-wide receipt-character" key={character.id}><dt>{t("taskDetail.character", { index: index + 1 })}</dt><dd><strong>{character.name}</strong> · {label(catalog.roleTypes, character.roleTypeId)}<br />{character.storyRole}<br />{character.personality}<br />{character.appearance}<br />{t("creative.fields.ageRange")}: {label(catalog.ageRanges, character.ageRangeId)} · {t("creative.fields.gender")}: {label(catalog.genders, character.genderId)}<br />{t("creative.fields.clothing")}: {character.clothing || "—"}<br />{t("creative.fields.emotion")}: {character.emotion || "—"}<br />{t("creative.fields.voiceHint")}: {character.voiceHint || "—"}</dd></div>)}</dl>
      </section>
      <section className="form-panel review-section">
        <div className="review-section-heading"><h2><span>4</span>{t("taskDetail.voice")}</h2><Link to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)}>{t("review.edit")}</Link></div>
        <dl className="data-grid"><div><dt>{t("voice.fields.contentLanguage")}</dt><dd>{label(catalog.contentLanguages, draft.voiceAndReferences.voiceover.contentLanguageId)}</dd></div><div><dt>{t("voice.fields.narrationTone")}</dt><dd>{label(catalog.narrationTones, draft.voiceAndReferences.voiceover.narrationToneId)}</dd></div><div><dt>{t("voice.fields.speechRate")}</dt><dd>{label(catalog.speechRates, draft.voiceAndReferences.voiceover.speechRateId)}</dd></div><div><dt>{t("voice.fields.voiceGender")}</dt><dd>{label(catalog.voiceGenders, draft.voiceAndReferences.voiceover.voiceGenderId)}</dd></div><div><dt>{t("voice.fields.voiceAge")}</dt><dd>{label(catalog.voiceAges, draft.voiceAndReferences.voiceover.voiceAgeId)}</dd></div><div><dt>{t("voice.fields.accent")}</dt><dd>{label(catalog.accents, draft.voiceAndReferences.voiceover.accentId)}</dd></div><div><dt>{t("voice.fields.emotionStyle")}</dt><dd>{label(catalog.voiceEmotions, draft.voiceAndReferences.voiceover.emotionStyleId)}</dd></div><div><dt>{t("taskDetail.preferredVoice")}</dt><dd>{label(voiceOptions, draft.voiceAndReferences.voiceover.preferredVoiceId)}</dd></div><div className="data-wide"><dt>{t("taskDetail.selectedVoices")}</dt><dd>{labels(voiceOptions, draft.voiceAndReferences.voiceover.selectedVoiceIds)}</dd></div><div className="data-wide"><dt>{t("voice.fields.pronunciationNotes")}</dt><dd>{draft.voiceAndReferences.voiceover.pronunciationNotes || "—"}</dd></div><div className="data-wide"><dt>{t("voice.fields.customVoice")}</dt><dd>{draft.voiceAndReferences.voiceover.customVoiceDescription || "—"}</dd></div><div className="data-wide"><dt>{t("taskDetail.referenceFiles")}</dt><dd>{draft.voiceAndReferences.assets.length ? <ul className="receipt-links">{draft.voiceAndReferences.assets.map((asset) => <li key={asset.id}><a href={asset.url}>{asset.fileName}</a></li>)}</ul> : "—"}</dd></div><div className="data-wide"><dt>{t("taskDetail.referenceLinks")}</dt><dd>{referenceUrls.length ? <ul className="receipt-links">{referenceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : "—"}</dd></div></dl>
      </section>
      <section className="form-panel review-section review-wide"><div className="review-section-heading"><h2><span>5</span>{t("taskDetail.direction")}</h2><Link to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)}>{t("review.edit")}</Link></div><dl className="data-grid"><div className="data-wide"><dt>{t("voice.fields.coreMessage")}</dt><dd>{draft.voiceAndReferences.creativeDirection.coreMessage}</dd></div><div><dt>{t("voice.fields.requiredScenes")}</dt><dd>{draft.voiceAndReferences.creativeDirection.requiredScenes || "—"}</dd></div><div><dt>{t("voice.fields.authorPreferences")}</dt><dd>{draft.voiceAndReferences.creativeDirection.authorPreferences || "—"}</dd></div><div><dt>{t("voice.fields.closingMessage")}</dt><dd>{draft.voiceAndReferences.creativeDirection.closingMessage || "—"}</dd></div><div><dt>{t("voice.fields.musicMood")}</dt><dd>{draft.voiceAndReferences.creativeDirection.musicMood || "—"}</dd></div><div className="data-wide"><dt>{t("voice.fields.avoidContent")}</dt><dd>{draft.voiceAndReferences.creativeDirection.avoidContent || "—"}</dd></div></dl></section>
    </div>
    <aside className="submit-notice"><div><strong>{t("review.noticeTitle")}</strong><p>{t("review.noticeBody")}</p></div></aside>
    <div className="sticky-actions"><Link className="button button-secondary" to={localizedPath(locale, `/tasks/${taskId}/edit/voice`)}>{t("common.back")}</Link><button className="button button-primary" type="button" disabled={submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? t("review.submitting") : t("review.submit")}</button></div>
  </div>;
}
