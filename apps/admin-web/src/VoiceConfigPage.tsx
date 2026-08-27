import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError, optionService } from "@lifewood/api-client";
import type { AdminVoiceReference, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import "./voice-config.css";
import { SettingsTabs } from "./SettingsTabs";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";

const emptyVoice: AdminVoiceReference = {
  id: "",
  audioUrl: null,
  nameZhCn: "",
  nameEnUs: "",
  descriptionZhCn: "",
  descriptionEnUs: "",
  tagIds: [],
  recommended: false,
  enabled: true,
  sortOrder: 100,
  updatedAt: null,
};

export function VoiceConfigPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminVoiceReference>();
  const [audioError, setAudioError] = useState<string>();
  const voices = useQuery({ queryKey: ["admin-voices"], queryFn: adminService.listVoiceReferences });
  const options = useQuery({ queryKey: ["form-options", locale], queryFn: () => optionService.getFormOptions(locale) });
  const refreshVoices = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-voices"] });
    await queryClient.invalidateQueries({ queryKey: ["voices"] });
  };
  const save = useMutation({
    mutationFn: adminService.saveVoiceReference,
    onSuccess: async () => {
      setEditing(undefined);
      showAdminToast(t("admin.feedback.voiceSaved"));
      await refreshVoices();
    },
  });
  const uploadSample = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => adminService.uploadVoiceSample(id, file),
    onSuccess: async () => { showAdminToast(t("admin.feedback.audioUploaded")); await refreshVoices(); },
  });
  const removeSample = useMutation({
    mutationFn: adminService.removeVoiceSample,
    onSuccess: async () => { showAdminToast(t("admin.feedback.audioRemoved")); await refreshVoices(); },
  });
  const audioBusy = uploadSample.isPending || removeSample.isPending;
  const audioMutationError = uploadSample.error || removeSample.error;
  const handleAudio = (voice: AdminVoiceReference, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (file.size > 20_000_000 || !["wav", "mp3"].includes(extension ?? "")) {
      setAudioError(t("admin.voices.audioInvalid"));
      return;
    }
    setAudioError(undefined);
    uploadSample.reset();
    removeSample.reset();
    uploadSample.mutate({ id: voice.id, file });
  };

  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    <section className="page-toolbar">
      <h1 className="config-context">{t("admin.voices.title")}</h1>
      <span className="result-count">{t("admin.voices.count", { count: voices.data?.length ?? 0 })}</span>
      <button className="primary push-right" type="button" onClick={() => { save.reset(); setEditing({ ...emptyVoice }); }}>{t("admin.voices.create")}</button>
    </section>
    {voices.isError && <div className="message error" role="alert">{localizedApiError(voices.error, t)}</div>}
    {(audioError || audioMutationError) && <div className="message error" role="alert" aria-live="polite">{audioError ?? localizedApiError(audioMutationError, t)}</div>}
    <section className="table-card">
      <table>
        <thead><tr><th>{t("admin.voices.reference")}</th><th>{t("admin.voices.tags")}</th><th>{t("admin.voices.audio")}</th><th>{t("admin.voices.order")}</th><th>{t("admin.voices.status")}</th><th>{t("admin.voices.action")}</th></tr></thead>
        <tbody>{voices.data?.map((voice) => <tr key={voice.id}>
          <td data-label={t("admin.voices.reference")}><div className="voice-config-name"><strong>{locale === "zh-CN" ? voice.nameZhCn : voice.nameEnUs}</strong><small translate="no">{voice.id}</small></div></td>
          <td data-label={t("admin.voices.tags")}><span className="voice-tags">{voice.tagIds.map((tag) => options.data?.voiceTags.find((item) => item.id === tag)?.label ?? tag).join(" · ") || "—"}</span></td>
          <td data-label={t("admin.voices.audio")}><div className="voice-audio-cell">
            <span className={voice.audioUrl ? "status active" : "status inactive"}>{t(voice.audioUrl ? "admin.voices.audioReady" : "admin.voices.audioEmpty")}</span>
            {voice.audioUrl && <audio controls preload="none" src={`/api/admin/voices/${encodeURIComponent(voice.id)}/sample`} aria-label={`${locale === "zh-CN" ? voice.nameZhCn : voice.nameEnUs} · ${t("admin.voices.audio")}`} />}
            <div className="voice-audio-actions">
              <label className="compact-action" aria-disabled={audioBusy}>
                <input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" disabled={audioBusy} onChange={(event) => handleAudio(voice, event)} />
                <span>{t(voice.audioUrl ? "admin.voices.replaceAudio" : "admin.voices.uploadAudio")}</span>
              </label>
              {voice.audioUrl && <button type="button" disabled={audioBusy} onClick={() => { if (!window.confirm(t("admin.voices.removeAudioConfirm"))) return; setAudioError(undefined); uploadSample.reset(); removeSample.reset(); removeSample.mutate(voice.id); }}>{t("admin.voices.removeAudio")}</button>}
            </div>
          </div></td>
          <td className="numeric" data-label={t("admin.voices.order")}>{voice.sortOrder}</td>
          <td data-label={t("admin.voices.status")}><span className={voice.enabled ? "status active" : "status inactive"}>{t(voice.enabled ? "admin.voices.enabled" : "admin.voices.disabled")}</span>{voice.recommended && <span className="status status-confirmed">{t("admin.voices.recommended")}</span>}</td>
          <td data-label={t("admin.voices.action")}><button type="button" onClick={() => { save.reset(); setEditing({ ...voice, tagIds: [...voice.tagIds] }); }}>{t("admin.voices.edit")}</button></td>
        </tr>)}</tbody>
      </table>
      {!voices.isPending && !voices.data?.length && <div className="empty">{t("admin.voices.empty")}</div>}
    </section>
    <p className="config-hint">{t("admin.voices.audioHint")}</p>
    {editing && <VoiceDialog voice={editing} tagOptions={[
      ...(options.data?.voiceTags ?? []),
      ...editing.tagIds.filter((id) => !(options.data?.voiceTags ?? []).some((item) => item.id === id)).map((id) => ({ id, label: `${t("admin.voices.unavailableTag")} · ${id}`, unavailable: true })),
    ]} busy={save.isPending} error={save.error} onClose={() => { save.reset(); setEditing(undefined); }} onSave={(value) => save.mutate(value)} />}
  </main>;
}

function VoiceDialog({ voice, tagOptions, busy, error, onClose, onSave }: {
  voice: AdminVoiceReference;
  tagOptions: Array<{ id: string; label: string; unavailable?: boolean }>;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (voice: AdminVoiceReference) => void;
}) {
  const { t } = useTranslation();
  const existing = Boolean(voice.id);
  const [selectedTags, setSelectedTags] = useState(voice.tagIds);
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get("id")).trim();
    const value = {
      ...voice,
      id,
      nameZhCn: String(data.get("nameZhCn")).trim(),
      nameEnUs: String(data.get("nameEnUs")).trim(),
      descriptionZhCn: String(data.get("descriptionZhCn")).trim(),
      descriptionEnUs: String(data.get("descriptionEnUs")).trim(),
      tagIds: selectedTags,
      recommended: data.get("recommended") === "on",
      enabled: data.get("enabled") === "on",
      sortOrder: Number(data.get("sortOrder")),
    };
    if (voice.enabled && !value.enabled && !window.confirm(t("admin.voices.disableConfirm"))) return;
    onSave(value);
  };
  return <ModalFrame labelledBy="voice-dialog-title" busy={busy} onClose={requestClose}>
    <div className="modal-title"><h2 id="voice-dialog-title">{t(existing ? "admin.voices.editTitle" : "admin.voices.createTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>×</button></div>
    <form onSubmit={submit} onChange={markDirty}>
      <div className="voice-form-grid">
        <label><span>{t("admin.voices.id")}</span><input name="id" defaultValue={voice.id} pattern="[A-Za-z0-9-]{2,64}" maxLength={64} readOnly={existing} required autoComplete="off" spellCheck={false} /></label>
        <label><span>{t("admin.voices.order")}</span><input name="sortOrder" type="number" inputMode="numeric" defaultValue={voice.sortOrder} min={0} max={10000} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.nameZh")}</span><input name="nameZhCn" defaultValue={voice.nameZhCn} maxLength={80} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.nameEn")}</span><input name="nameEnUs" defaultValue={voice.nameEnUs} maxLength={80} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.descriptionZh")}</span><textarea name="descriptionZhCn" defaultValue={voice.descriptionZhCn} rows={2} maxLength={500} required /></label>
        <label><span>{t("admin.voices.descriptionEn")}</span><textarea name="descriptionEnUs" defaultValue={voice.descriptionEnUs} rows={2} maxLength={500} required /></label>
      </div>
      <fieldset><legend>{t("admin.voices.tags")}</legend><div className="tag-checks">{tagOptions.map((tag) => <label key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} checked={selectedTags.includes(tag.id)} disabled={tag.unavailable && !selectedTags.includes(tag.id)} onChange={(event) => setSelectedTags((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} /><span>{tag.label}</span></label>)}</div></fieldset>
      <div className="toggle-row"><label><input type="checkbox" name="enabled" defaultChecked={voice.enabled} /><span>{t("admin.voices.enabled")}</span></label><label><input type="checkbox" name="recommended" defaultChecked={voice.recommended} /><span>{t("admin.voices.recommended")}</span></label></div>
      {Boolean(error) && <div className="message error" role="alert" aria-live="polite">{localizedApiError(error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "admin.voices.saving" : "common.save")}</button></div>
    </form>
  </ModalFrame>;
}
