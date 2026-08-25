import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { ConfigOption, TaskDraft } from "@lifewood/domain";
import { Field } from "../components/Field";
import { ChoiceField } from "../components/ChoiceField";
import { StepProgress } from "../components/StepProgress";
import { createCreativeDraftSchema, createCreativeStepSchema, emptyCharacter, type CreativeFormValues } from "./creativeFormSchema";
import { mergeLegacyOptions, type DisplayConfigOption } from "../legacy-options";

function Options({ items }: { items: DisplayConfigOption[] }) {
  return <>{items.map((item) => <option key={item.id} value={item.id} disabled={item.unavailable}>{item.label}</option>)}</>;
}

function CharacterIdentity({ control, index, roleTypes }: { control: Control<CreativeFormValues>; index: number; roleTypes: ConfigOption[] }) {
  const { t } = useTranslation();
  const character = useWatch({ control, name: `characters.${index}` });
  return <div><strong>{character?.name || t("creative.unnamedCharacter")}</strong><span>{roleTypes.find((item) => item.id === character?.roleTypeId)?.label ?? t("creative.rolePending")}</span></div>;
}

function CreativeSummary({ control, visualStyles, roleTypes, styleTagMap }: { control: Control<CreativeFormValues>; visualStyles: ConfigOption[]; roleTypes: ConfigOption[]; styleTagMap: Map<string, string> }) {
  const { t } = useTranslation();
  const [characters, visualStyleId, moodTagIds, imageStyleTagIds, paceTagIds] = useWatch({ control, name: ["characters", "visualStyleId", "moodTagIds", "imageStyleTagIds", "paceTagIds"] });
  const selectedStyle = visualStyles.find((item) => item.id === visualStyleId);
  return <aside className="creative-summary">
    <div className="casting-card"><span className="folio-label">{t("creative.summary.casting")}</span><strong>{t("creative.summary.characterCount", { count: characters.length })}</strong><div className="casting-stack">{characters.slice(0, 5).map((character, index) => <div key={character.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{character.name || t("creative.unnamedCharacter")}</strong><small>{roleTypes.find((item) => item.id === character.roleTypeId)?.label ?? "—"}</small></div></div>)}</div>{characters.length > 5 && <small>{t("creative.summary.more", { count: characters.length - 5 })}</small>}</div>
    <div className="style-summary-card"><span className="folio-label">{t("creative.summary.direction")}</span><div className="summary-swatch" style={{ backgroundColor: selectedStyle?.previewColor ?? "#e7e7e1" }}><i /></div><strong>{selectedStyle?.label ?? t("creative.summary.noStyle")}</strong><p>{[...moodTagIds, ...imageStyleTagIds, ...paceTagIds].map((id) => styleTagMap.get(id)).filter(Boolean).join(" · ") || t("creative.summary.noTags")}</p></div>
    <div className="next-card"><span className="next-mark" aria-hidden="true">→</span><div><h3>{t("creative.summary.nextTitle")}</h3><p>{t("creative.summary.nextBody")}</p></div></div>
  </aside>;
}

export function CreativeFormPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draftSchema = useMemo(() => createCreativeDraftSchema(t), [t]);
  const stepSchema = useMemo(() => createCreativeStepSchema(t), [t]);
  const draftQuery = useQuery({ queryKey: ["project", taskId], queryFn: () => projectService.getProject(taskId!, validLocale), enabled: Boolean(taskId) });
  const optionsQuery = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const form = useForm<CreativeFormValues>({
    resolver: zodResolver(draftSchema),
    defaultValues: { characters: [], visualStyleId: "", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [] },
  });
  const characters = useFieldArray({ control: form.control, name: "characters", keyName: "formKey" });
  const selectedMoodTagIds = useWatch({ control: form.control, name: "moodTagIds" });
  const selectedImageStyleTagIds = useWatch({ control: form.control, name: "imageStyleTagIds" });
  const selectedPaceTagIds = useWatch({ control: form.control, name: "paceTagIds" });

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    form.reset({
      characters: draft.creative.characters.map((character) => ({
        id: character.id, roleTypeId: character.roleTypeId ?? "", name: character.name, storyRole: character.storyRole,
        personality: character.personality, appearance: character.appearance, ageRangeId: character.ageRangeId ?? "",
        genderId: character.genderId ?? "", clothing: character.clothing ?? "", emotion: character.emotion ?? "",
        voiceHint: character.voiceHint ?? "", referenceImageUrls: character.referenceImageUrls,
      })),
      visualStyleId: draft.creative.visualStyleId ?? "", moodTagIds: draft.creative.moodTagIds,
      imageStyleTagIds: draft.creative.imageStyleTagIds, paceTagIds: draft.creative.paceTagIds,
      styleReferenceImageUrls: draft.creative.styleReferenceImageUrls,
    });
  }, [draftQuery.data, form, form.formState.isDirty]);

  useEffect(() => {
    const dirty = form.formState.isDirty;
    document.body.dataset.unsavedChanges = String(dirty);
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const preventBackLoss = () => { if (dirty && !window.confirm(t("wizard.unsavedChanges"))) window.history.go(1); };
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("popstate", preventBackLoss);
    return () => { window.removeEventListener("beforeunload", preventLoss); window.removeEventListener("popstate", preventBackLoss); delete document.body.dataset.unsavedChanges; };
  }, [form.formState.isDirty, t]);

  const saveCreative = useMutation({
    mutationFn: async ({ values, continueAfter }: { values: CreativeFormValues; continueAfter: boolean }) => {
      setSaveState("saving");
      const current = draftQuery.data!;
      const next: TaskDraft = { ...current, creative: {
        characters: values.characters.map((character) => ({ ...character,
          roleTypeId: character.roleTypeId || undefined, ageRangeId: character.ageRangeId || undefined,
          genderId: character.genderId || undefined, clothing: character.clothing || undefined,
          emotion: character.emotion || undefined, voiceHint: character.voiceHint || undefined,
        })),
        visualStyleId: values.visualStyleId || undefined, moodTagIds: values.moodTagIds, imageStyleTagIds: values.imageStyleTagIds,
        paceTagIds: values.paceTagIds, styleReferenceImageUrls: values.styleReferenceImageUrls,
      }};
      const saved = await projectService.saveCreative(current.id, next, validLocale);
      return { saved, continueAfter };
    },
    onSuccess: ({ saved, continueAfter }) => {
      queryClient.setQueryData(["project", taskId], saved);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      form.reset(form.getValues());
      setSaveState("saved");
      if (continueAfter) navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/voice`));
    },
    onError: () => setSaveState("error"),
  });

  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  if (draftQuery.isError || optionsQuery.isError || !draftQuery.data || !optionsQuery.data) return <div className="screen-status" role="alert">{localizedApiError(draftQuery.error ?? optionsQuery.error, t)}</div>;
  if (draftQuery.data.status !== "draft") return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />;

  const options = optionsQuery.data;
  const previous = draftQuery.data.creative;
  const unavailable = t("wizard.unavailableOption");
  const roleOptions = mergeLegacyOptions(options.roleTypes, previous.characters.map((item) => item.roleTypeId), unavailable);
  const ageOptions = mergeLegacyOptions(options.ageRanges, previous.characters.map((item) => item.ageRangeId), unavailable);
  const genderOptions = mergeLegacyOptions(options.genders, previous.characters.map((item) => item.genderId), unavailable);
  const visualStyleOptions = mergeLegacyOptions(options.visualStyles, [previous.visualStyleId], unavailable);
  const moodOptions = mergeLegacyOptions(options.moodTags, previous.moodTagIds, unavailable);
  const imageStyleOptions = mergeLegacyOptions(options.imageStyleTags, previous.imageStyleTagIds, unavailable);
  const paceOptions = mergeLegacyOptions(options.paceTags, previous.paceTagIds, unavailable);
  const styleTagMap = new Map([...moodOptions, ...imageStyleOptions, ...paceOptions].map((item) => [item.id, item.label]));
  const conflict = saveCreative.error instanceof ApiError && saveCreative.error.details.code === "project.version_conflict";
  const statusText = saveState === "saving" ? t("common.saving") : saveState === "saved" ? t("common.saved") : saveState === "error" ? t(conflict ? "wizard.versionConflict" : "wizard.saveFailed") : "";
  const guardLink = (event: MouseEvent<HTMLAnchorElement>) => { if (form.formState.isDirty && !window.confirm(t("wizard.unsavedChanges"))) event.preventDefault(); };
  const continueStep = form.handleSubmit((values) => {
    const checked = stepSchema.safeParse(values);
    if (!checked.success) {
      checked.error.issues.forEach((issue) => form.setError(issue.path as never, { message: issue.message }));
      const first = checked.error.issues[0]?.path.join(".");
      if (first) requestAnimationFrame(() => (first === "characters"
        ? document.getElementById("characters-error-target")
        : document.querySelector<HTMLElement>(`[name="${first}"]`))?.focus());
      return;
    }
    saveCreative.mutate({ values: checked.data, continueAfter: true });
  });

  return <div className="wizard-page creative-page">
    <div className="wizard-heading"><div><h1>{t("wizard.pageTitles.characters")}</h1><p>{t("wizard.pageSubtitles.characters")}</p></div><span className={`save-state save-${saveState}`} role={saveState === "error" ? "alert" : "status"}>{statusText}</span></div>
    <StepProgress current={2} />
    <form autoComplete="off" onSubmit={continueStep}>
      <div className="creative-layout">
        <div className="form-stack">
          <section className="form-panel character-section" id="characters-error-target" tabIndex={-1}>
            <div className="section-heading"><div><h2><span>2.1</span>{t("creative.sections.characters")}</h2><p>{t("creative.characterHint")}</p></div><button className="button button-secondary" type="button" disabled={characters.fields.length >= 12} onClick={() => characters.append(emptyCharacter())}><span aria-hidden="true">＋</span>{t("creative.addCharacter")}</button></div>
            {characters.fields.length === 0 && <div className="character-empty"><span aria-hidden="true">＋</span><div><strong>{t("creative.emptyTitle")}</strong><p>{t("creative.emptyBody")}</p></div><button className="button button-primary" type="button" onClick={() => characters.append(emptyCharacter())}>{t("creative.addFirst")}</button></div>}
            {typeof form.formState.errors.characters?.message === "string" && <div className="field-error" id="characters-error" role="alert">{form.formState.errors.characters.message}</div>}
            <div className="character-list">{characters.fields.map((character, index) => <article className="character-card" key={character.formKey}>
              <div className="character-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
              <div className="character-content">
                <div className="character-card-heading"><CharacterIdentity control={form.control} index={index} roleTypes={roleOptions} /><div className="character-actions"><button type="button" aria-label={t("creative.moveUp")} disabled={index === 0} onClick={() => characters.swap(index, index - 1)}>↑</button><button type="button" aria-label={t("creative.moveDown")} disabled={index === characters.fields.length - 1} onClick={() => characters.swap(index, index + 1)}>↓</button><button type="button" className="danger-link" onClick={() => { if (window.confirm(t("creative.deleteConfirm"))) characters.remove(index); }}>{t("creative.delete")}</button></div></div>
                <div className="form-grid character-grid">
                  <Field label={t("creative.fields.roleType")} htmlFor={`roleType-${index}`} required error={form.formState.errors.characters?.[index]?.roleTypeId?.message}><select id={`roleType-${index}`} {...form.register(`characters.${index}.roleTypeId`)}><option value="" /><Options items={roleOptions} /></select></Field>
                  <Field label={t("creative.fields.characterName")} htmlFor={`characterName-${index}`} required error={form.formState.errors.characters?.[index]?.name?.message}><input id={`characterName-${index}`} {...form.register(`characters.${index}.name`)} /></Field>
                  <Field label={t("creative.fields.storyRole")} htmlFor={`storyRole-${index}`} required className="field-wide" error={form.formState.errors.characters?.[index]?.storyRole?.message}><textarea id={`storyRole-${index}`} rows={2} maxLength={200} {...form.register(`characters.${index}.storyRole`)} /></Field>
                  <Field label={t("creative.fields.personality")} htmlFor={`personality-${index}`} required error={form.formState.errors.characters?.[index]?.personality?.message}><textarea id={`personality-${index}`} rows={3} maxLength={300} {...form.register(`characters.${index}.personality`)} /></Field>
                  <Field label={t("creative.fields.appearance")} htmlFor={`appearance-${index}`} required error={form.formState.errors.characters?.[index]?.appearance?.message}><textarea id={`appearance-${index}`} rows={3} maxLength={300} {...form.register(`characters.${index}.appearance`)} /></Field>
                  <Field label={t("creative.fields.ageRange")} htmlFor={`ageRange-${index}`}><select id={`ageRange-${index}`} {...form.register(`characters.${index}.ageRangeId`)}><option value="" /><Options items={ageOptions} /></select></Field>
                  <Field label={t("creative.fields.gender")} htmlFor={`gender-${index}`}><select id={`gender-${index}`} {...form.register(`characters.${index}.genderId`)}><option value="" /><Options items={genderOptions} /></select></Field>
                  <Field label={t("creative.fields.clothing")} htmlFor={`clothing-${index}`} error={form.formState.errors.characters?.[index]?.clothing?.message}><input id={`clothing-${index}`} maxLength={200} {...form.register(`characters.${index}.clothing`)} /></Field>
                  <Field label={t("creative.fields.emotion")} htmlFor={`emotion-${index}`} error={form.formState.errors.characters?.[index]?.emotion?.message}><input id={`emotion-${index}`} maxLength={150} {...form.register(`characters.${index}.emotion`)} /></Field>
                  <Field label={t("creative.fields.voiceHint")} htmlFor={`voiceHint-${index}`} className="field-wide" error={form.formState.errors.characters?.[index]?.voiceHint?.message}><input id={`voiceHint-${index}`} className="input-long" maxLength={100} {...form.register(`characters.${index}.voiceHint`)} /></Field>
                </div>
              </div>
            </article>)}</div>
          </section>

          <section className="form-panel style-section">
            <h2><span>2.2</span>{t("creative.sections.style")}</h2>
            <fieldset className="style-fieldset" aria-required="true" aria-invalid={form.formState.errors.visualStyleId ? true : undefined} aria-describedby={form.formState.errors.visualStyleId ? "visual-style-error" : undefined}><legend>{t("creative.fields.visualStyle")}<span className="required" aria-hidden="true">*</span></legend><div className="style-grid">{visualStyleOptions.map((item) => <label className="style-option" key={item.id}><input type="radio" value={item.id} disabled={item.unavailable} {...form.register("visualStyleId")} /><span className="style-swatch" style={{ backgroundColor: item.previewColor ?? "#d8d4c7" }} aria-hidden="true"><i /></span><strong>{item.label}</strong></label>)}</div>{form.formState.errors.visualStyleId?.message && <div className="field-error" id="visual-style-error" role="alert">{form.formState.errors.visualStyleId.message}</div>}</fieldset>
            <ChoiceField label={t("creative.fields.moodTags")} id="mood-tags" error={form.formState.errors.moodTagIds?.message}><div className="choice-row">{moodOptions.map((item) => <label className="choice-chip" key={item.id}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedMoodTagIds.includes(item.id)} {...form.register("moodTagIds")} /><span>{item.label}</span></label>)}</div></ChoiceField>
            <ChoiceField label={t("creative.fields.imageTags")} id="image-tags" error={form.formState.errors.imageStyleTagIds?.message}><div className="choice-row">{imageStyleOptions.map((item) => <label className="choice-chip" key={item.id}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedImageStyleTagIds.includes(item.id)} {...form.register("imageStyleTagIds")} /><span>{item.label}</span></label>)}</div></ChoiceField>
            <ChoiceField label={t("creative.fields.paceTags")} id="pace-tags" error={form.formState.errors.paceTagIds?.message}><div className="choice-row">{paceOptions.map((item) => <label className="choice-chip" key={item.id}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedPaceTagIds.includes(item.id)} {...form.register("paceTagIds")} /><span>{item.label}</span></label>)}</div></ChoiceField>
          </section>
        </div>

        <CreativeSummary control={form.control} visualStyles={visualStyleOptions} roleTypes={roleOptions} styleTagMap={styleTagMap} />
      </div>
      <div className="sticky-actions"><Link className="button button-secondary" to={localizedPath(validLocale, `/tasks/${taskId}/edit/project`)} onClick={guardLink}>{t("wizard.actions.backUpload")}</Link><p className="sticky-note">{t("wizard.footerNotes.characters")}</p><div><button className="button button-secondary" type="button" disabled={saveCreative.isPending} onClick={form.handleSubmit((values) => saveCreative.mutate({ values, continueAfter: false }))}>{saveCreative.isPending ? t("common.saving") : t("common.save")}</button>{conflict && <button className="button button-secondary" type="button" onClick={() => { form.reset(); void draftQuery.refetch(); }}>{t("common.reload")}</button>}<button className="button button-primary" type="submit" disabled={saveCreative.isPending}>{saveCreative.isPending ? t("common.saving") : t("wizard.actions.toVoice")}<span aria-hidden="true">→</span></button></div></div>
    </form>
  </div>;
}
