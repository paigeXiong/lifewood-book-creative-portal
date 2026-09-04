import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AdminFormOption, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import { SettingsTabs } from "./SettingsTabs";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";

const groups = ["brands", "video-goals", "audiences", "genres", "content-languages", "video-durations", "publishing-platforms", "role-types", "age-ranges", "genders", "visual-styles", "mood-tags", "image-style-tags", "pace-tags", "narration-tones", "speech-rates", "voice-genders", "voice-ages", "accents", "voice-emotions", "voice-tags"] as const;
type GroupId = typeof groups[number];

function emptyOption(groupId: GroupId): AdminFormOption {
  return { groupId, id: "", labelZhCn: "", labelEnUs: "", allowsCustomValue: false, enabled: true, sortOrder: 100 };
}

export function FormOptionConfigPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState<GroupId>("brands");
  const [editing, setEditing] = useState<AdminFormOption>();
  const options = useQuery({ queryKey: ["admin-form-options", groupId], queryFn: () => adminService.listFormOptions(groupId) });
  const save = useMutation({
    mutationFn: adminService.saveFormOption,
    onSuccess: async () => {
      setEditing(undefined);
      showAdminToast(t("admin.feedback.optionSaved"));
      await queryClient.invalidateQueries({ queryKey: ["admin-form-options", groupId] });
      await queryClient.invalidateQueries({ queryKey: ["form-options"] });
    },
  });

  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    <section className="page-toolbar">
      <label className="config-group-picker"><span className="sr-only">{t("admin.formOptions.group")}</span><select value={groupId} onChange={(event) => { setGroupId(event.target.value as GroupId); setEditing(undefined); }}>
        {groups.map((id) => <option key={id} value={id}>{t(`admin.formOptions.groups.${id}`)}</option>)}
      </select></label>
      <span className="result-count">{t("admin.formOptions.count", { count: options.data?.length ?? 0 })}</span>
      <button className="primary push-right" type="button" onClick={() => { save.reset(); setEditing(emptyOption(groupId)); }}>{t("admin.formOptions.create")}</button>
    </section>
    {options.isError && <div className="message error" role="alert">{localizedApiError(options.error, t)}</div>}
    <section className="table-card">
      <table><thead><tr><th>{t("admin.formOptions.option")}</th><th>{t("admin.formOptions.secondaryLabel")}</th><th>{t("admin.formOptions.order")}</th><th>{t("admin.formOptions.status")}</th><th>{t("admin.formOptions.action")}</th></tr></thead>
        <tbody>{options.data?.map((option) => <tr key={option.id}>
          <td data-label={t("admin.formOptions.option")}><div className="voice-config-name"><strong>{locale === "zh-CN" ? option.labelZhCn : option.labelEnUs}</strong><small translate="no">{option.id}</small></div></td>
          <td data-label={t("admin.formOptions.secondaryLabel")}>{locale === "zh-CN" ? option.labelEnUs : option.labelZhCn}</td>
          <td className="numeric" data-label={t("admin.formOptions.order")}>{option.sortOrder}</td>
          <td data-label={t("admin.formOptions.status")}><span className={option.enabled ? "status active" : "status inactive"}>{t(option.enabled ? "admin.formOptions.enabled" : "admin.formOptions.disabled")}</span></td>
          <td data-label={t("admin.formOptions.action")}><button type="button" onClick={() => { save.reset(); setEditing({ ...option }); }}>{t("admin.formOptions.edit")}</button></td>
        </tr>)}</tbody>
      </table>
      {!options.isPending && !options.data?.length && <div className="empty">{t("admin.formOptions.empty")}</div>}
    </section>
    {editing && <FormOptionDialog option={editing} busy={save.isPending} error={save.error} onClose={() => { save.reset(); setEditing(undefined); }} onSave={(value) => save.mutate(value)} />}
  </main>;
}

function FormOptionDialog({ option, busy, error, onClose, onSave }: { option: AdminFormOption; busy: boolean; error: unknown; onClose: () => void; onSave: (option: AdminFormOption) => void }) {
  const { t } = useTranslation();
  const existing = Boolean(option.id);
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = { ...option,
      id: String(data.get("id")).trim(),
      labelZhCn: String(data.get("labelZhCn")).trim(),
      labelEnUs: String(data.get("labelEnUs")).trim(),
      descriptionZhCn: String(data.get("descriptionZhCn")).trim() || undefined,
      descriptionEnUs: String(data.get("descriptionEnUs")).trim() || undefined,
      enabled: data.get("enabled") === "on",
      sortOrder: Number(data.get("sortOrder")),
      previewColor: data.has("previewColor") ? String(data.get("previewColor")) : option.previewColor,
      previewImageUrl: data.has("previewImageUrl") ? String(data.get("previewImageUrl")).trim() || undefined : option.previewImageUrl,
      previewVideoUrl: data.has("previewVideoUrl") ? String(data.get("previewVideoUrl")).trim() || undefined : option.previewVideoUrl,
      allowsCustomValue: option.groupId === "video-durations" && data.get("allowsCustomValue") === "on",
    };
    if (option.enabled && !value.enabled && !window.confirm(t("admin.formOptions.disableConfirm"))) return;
    onSave(value);
  };
  return <ModalFrame labelledBy="form-option-dialog-title" busy={busy} onClose={requestClose}>
    <div className="modal-title"><h2 id="form-option-dialog-title">{t(existing ? "admin.formOptions.editTitle" : "admin.formOptions.createTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>×</button></div>
    <form onSubmit={submit} onChange={markDirty}>
      <div className="voice-form-grid">
        <label><span>{t("admin.formOptions.id")}</span><input name="id" defaultValue={option.id} pattern="[A-Za-z0-9-]{2,64}" maxLength={64} readOnly={existing} required autoComplete="off" spellCheck={false} /></label>
        <label><span>{t("admin.formOptions.order")}</span><input name="sortOrder" type="number" inputMode="numeric" defaultValue={option.sortOrder} min={0} max={10000} required autoComplete="off" /></label>
        <label><span>{t("admin.formOptions.labelZh")}</span><input name="labelZhCn" defaultValue={option.labelZhCn} maxLength={100} required autoComplete="off" /></label>
        <label><span>{t("admin.formOptions.labelEn")}</span><input name="labelEnUs" defaultValue={option.labelEnUs} maxLength={100} required autoComplete="off" /></label>
        <label><span>{t("admin.formOptions.descriptionZh")}</span><textarea name="descriptionZhCn" defaultValue={option.descriptionZhCn} rows={2} maxLength={300} /></label>
        <label><span>{t("admin.formOptions.descriptionEn")}</span><textarea name="descriptionEnUs" defaultValue={option.descriptionEnUs} rows={2} maxLength={300} /></label>
        {option.groupId === "visual-styles" && <label><span>{t("admin.formOptions.previewColor")}</span><input name="previewColor" type="color" defaultValue={option.previewColor ?? "#1f6b50"} /></label>}
        {option.groupId === "visual-styles" && <>
          <label><span>{t("admin.formOptions.previewImageUrl")}</span><input name="previewImageUrl" defaultValue={option.previewImageUrl ?? ""} maxLength={2048} autoComplete="off" spellCheck={false} /></label>
          <label><span>{t("admin.formOptions.previewVideoUrl")}</span><input name="previewVideoUrl" defaultValue={option.previewVideoUrl ?? ""} maxLength={2048} autoComplete="off" spellCheck={false} /></label>
        </>}
      </div>
      {option.groupId === "video-durations" && <div className="toggle-row"><label><input type="checkbox" name="allowsCustomValue" defaultChecked={option.allowsCustomValue} /><span>{t("admin.formOptions.allowsCustomValue")}</span></label><small>{t("admin.formOptions.allowsCustomValueHint")}</small></div>}
      <div className="toggle-row"><label><input type="checkbox" name="enabled" defaultChecked={option.enabled} /><span>{t("admin.formOptions.enabled")}</span></label></div>
      {Boolean(error) && <div className="message error" role="alert" aria-live="polite">{localizedApiError(error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "admin.formOptions.saving" : "common.save")}</button></div>
    </form>
  </ModalFrame>;
}
