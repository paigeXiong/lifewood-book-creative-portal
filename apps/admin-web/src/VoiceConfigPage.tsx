import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError, optionService } from "@lifewood/api-client";
import type { AdminVoiceReference, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import "./voice-config.css";
import { SettingsTabs } from "./SettingsTabs";

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
};

export function VoiceConfigPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminVoiceReference>();
  const voices = useQuery({ queryKey: ["admin-voices"], queryFn: adminService.listVoiceReferences });
  const options = useQuery({ queryKey: ["form-options", locale], queryFn: () => optionService.getFormOptions(locale) });
  const save = useMutation({
    mutationFn: adminService.saveVoiceReference,
    onSuccess: async () => {
      setEditing(undefined);
      await queryClient.invalidateQueries({ queryKey: ["admin-voices"] });
      await queryClient.invalidateQueries({ queryKey: ["voices"] });
    },
  });

  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    <section className="page-toolbar">
      <h1 className="config-context">{t("admin.voices.title")}</h1>
      <span className="result-count">{t("admin.voices.count", { count: voices.data?.length ?? 0 })}</span>
      <button className="primary push-right" type="button" onClick={() => { save.reset(); setEditing({ ...emptyVoice }); }}>{t("admin.voices.create")}</button>
    </section>
    {voices.isError && <div className="message error" role="alert">{localizedApiError(voices.error, t)}</div>}
    <section className="table-card">
      <table>
        <thead><tr><th>{t("admin.voices.reference")}</th><th>{t("admin.voices.tags")}</th><th>{t("admin.voices.order")}</th><th>{t("admin.voices.status")}</th><th>{t("admin.voices.action")}</th></tr></thead>
        <tbody>{voices.data?.map((voice) => <tr key={voice.id}>
          <td><div className="voice-config-name"><strong>{locale === "zh-CN" ? voice.nameZhCn : voice.nameEnUs}</strong><small translate="no">{voice.id}</small></div></td>
          <td><span className="voice-tags">{voice.tagIds.map((tag) => options.data?.voiceTags.find((item) => item.id === tag)?.label ?? tag).join(" · ") || "—"}</span></td>
          <td className="numeric">{voice.sortOrder}</td>
          <td><span className={voice.enabled ? "status active" : "status inactive"}>{t(voice.enabled ? "admin.voices.enabled" : "admin.voices.disabled")}</span>{voice.recommended && <span className="status status-confirmed">{t("admin.voices.recommended")}</span>}</td>
          <td><button type="button" onClick={() => { save.reset(); setEditing({ ...voice, tagIds: [...voice.tagIds] }); }}>{t("admin.voices.edit")}</button></td>
        </tr>)}</tbody>
      </table>
      {!voices.isPending && !voices.data?.length && <div className="empty">{t("admin.voices.empty")}</div>}
    </section>
    {editing && <VoiceDialog voice={editing} tagOptions={options.data?.voiceTags ?? []} busy={save.isPending} error={save.error} onClose={() => { save.reset(); setEditing(undefined); }} onSave={(value) => save.mutate(value)} />}
  </main>;
}

function VoiceDialog({ voice, tagOptions, busy, error, onClose, onSave }: {
  voice: AdminVoiceReference;
  tagOptions: Array<{ id: string; label: string }>;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (voice: AdminVoiceReference) => void;
}) {
  const { t } = useTranslation();
  const existing = Boolean(voice.id);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get("id")).trim();
    onSave({
      ...voice,
      id,
      nameZhCn: String(data.get("nameZhCn")).trim(),
      nameEnUs: String(data.get("nameEnUs")).trim(),
      descriptionZhCn: String(data.get("descriptionZhCn")).trim(),
      descriptionEnUs: String(data.get("descriptionEnUs")).trim(),
      tagIds: data.getAll("tagIds").map(String),
      recommended: data.get("recommended") === "on",
      enabled: data.get("enabled") === "on",
      sortOrder: Number(data.get("sortOrder")),
    });
  };
  return <ModalFrame labelledBy="voice-dialog-title" busy={busy} onClose={onClose}>
    <div className="modal-title"><h2 id="voice-dialog-title">{t(existing ? "admin.voices.editTitle" : "admin.voices.createTitle")}</h2><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></div>
    <form onSubmit={submit}>
      <div className="voice-form-grid">
        <label><span>{t("admin.voices.id")}</span><input name="id" defaultValue={voice.id} pattern="[A-Za-z0-9-]{2,64}" maxLength={64} readOnly={existing} required autoComplete="off" spellCheck={false} /></label>
        <label><span>{t("admin.voices.order")}</span><input name="sortOrder" type="number" inputMode="numeric" defaultValue={voice.sortOrder} min={0} max={10000} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.nameZh")}</span><input name="nameZhCn" defaultValue={voice.nameZhCn} maxLength={80} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.nameEn")}</span><input name="nameEnUs" defaultValue={voice.nameEnUs} maxLength={80} required autoComplete="off" /></label>
        <label><span>{t("admin.voices.descriptionZh")}</span><textarea name="descriptionZhCn" defaultValue={voice.descriptionZhCn} rows={2} maxLength={500} required /></label>
        <label><span>{t("admin.voices.descriptionEn")}</span><textarea name="descriptionEnUs" defaultValue={voice.descriptionEnUs} rows={2} maxLength={500} required /></label>
      </div>
      <fieldset><legend>{t("admin.voices.tags")}</legend><div className="tag-checks">{tagOptions.map((tag) => <label key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={voice.tagIds.includes(tag.id)} /><span>{tag.label}</span></label>)}</div></fieldset>
      <div className="toggle-row"><label><input type="checkbox" name="enabled" defaultChecked={voice.enabled} /><span>{t("admin.voices.enabled")}</span></label><label><input type="checkbox" name="recommended" defaultChecked={voice.recommended} /><span>{t("admin.voices.recommended")}</span></label></div>
      {Boolean(error) && <div className="message error" role="alert" aria-live="polite">{localizedApiError(error, t)}</div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "admin.voices.saving" : "common.save")}</button></div>
    </form>
  </ModalFrame>;
}
