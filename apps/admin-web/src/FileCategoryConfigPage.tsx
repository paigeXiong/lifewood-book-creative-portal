import { useConfigRemoval } from "./useConfigRemoval";
import { useConfirm } from "./useConfirm";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AdminFileCategory, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import { SettingsTabs } from "./SettingsTabs";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";

type Scope = "source" | "reference";

function emptyCategory(scope: Scope): AdminFileCategory {
  return { scope, id: "", labelZhCn: "", labelEnUs: "", accept: ["application/pdf"], maxBytes: 20_000_000, maxFiles: 1, allowsUrl: false, required: false, enabled: true, sortOrder: 100 };
}

export function FileCategoryConfigPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>("source");
  const [editing, setEditing] = useState<AdminFileCategory>();
  const categories = useQuery({ queryKey: ["admin-file-categories", scope], queryFn: () => adminService.listFileCategories(scope) });
  const supportedTypes = useQuery({ queryKey: ["admin-file-content-types"], queryFn: adminService.listSupportedFileContentTypes });
  const save = useMutation({
    mutationFn: adminService.saveFileCategory,
    onSuccess: async () => {
      setEditing(undefined);
      showAdminToast(t("admin.feedback.categorySaved"));
      await queryClient.invalidateQueries({ queryKey: ["admin-file-categories", scope] });
      await queryClient.invalidateQueries({ queryKey: ["form-options"] });
    },
  });
  const removal = useConfigRemoval(adminService.removeFileCategory, async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-file-categories"] });
    await queryClient.invalidateQueries({ queryKey: ["form-options"] });
  });
  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    <section className="page-toolbar">
      <label className="config-group-picker"><span className="sr-only">{t("admin.fileCategories.scope")}</span><select value={scope} onChange={(event) => { removal.reset(); setScope(event.target.value as Scope); setEditing(undefined); }}>
        <option value="source">{t("admin.fileCategories.scopes.source")}</option>
        <option value="reference">{t("admin.fileCategories.scopes.reference")}</option>
      </select></label>
      <span className="result-count">{t("admin.fileCategories.count", { count: categories.data?.length ?? 0 })}</span>
      <button className="primary push-right" type="button" disabled={removal.busy} onClick={() => { save.reset(); setEditing(emptyCategory(scope)); }}>{t("admin.fileCategories.create")}</button>
    </section>
    {categories.isError && <div className="message error" role="alert">{localizedApiError(categories.error, t)}</div>}
    {removal.error && <div className="message error" role="alert">{localizedApiError(removal.error, t)}</div>}
    <section className="table-card config-removable"><table><thead><tr>
      <th>{t("admin.fileCategories.category")}</th><th>{t("admin.fileCategories.constraints")}</th><th>{t("admin.fileCategories.order")}</th><th>{t("admin.fileCategories.status")}</th><th>{t("admin.fileCategories.action")}</th>
    </tr></thead><tbody>{categories.data?.map((category) => <tr key={category.id}>
      <td data-label={t("admin.fileCategories.category")}><div className="voice-config-name"><strong>{locale === "zh-CN" ? category.labelZhCn : category.labelEnUs}</strong><small translate="no">{category.id}</small></div></td>
      <td data-label={t("admin.fileCategories.constraints")}><div className="voice-config-name"><span>{t("admin.fileCategories.limitSummary", { size: category.maxBytes / 1_000_000, count: category.maxFiles })}</span><small translate="no">{category.accept.join(", ")}</small></div></td>
      <td className="numeric" data-label={t("admin.fileCategories.order")}>{category.sortOrder}</td>
      <td data-label={t("admin.fileCategories.status")}><span className={category.enabled ? "status active" : "status inactive"}>{t(category.enabled ? "admin.formOptions.enabled" : "admin.formOptions.disabled")}</span></td>
      <td data-label={t("admin.fileCategories.action")}><div className="config-row-actions"><button type="button" disabled={removal.busy} onClick={() => { save.reset(); setEditing({ ...category }); }}>{t("admin.formOptions.edit")}</button><button type="button" className="config-delete" disabled={removal.busy} onClick={() => void removal.run(category, locale === "zh-CN" ? category.labelZhCn : category.labelEnUs)}>{t("admin.configRemoval.remove")}</button></div></td>
    </tr>)}</tbody></table>{!categories.isPending && !categories.data?.length && <div className="empty">{t("admin.fileCategories.empty")}</div>}</section>
    {editing && supportedTypes.data && <FileCategoryDialog supportedTypes={supportedTypes.data} category={editing} busy={save.isPending} error={save.error} onClose={() => { save.reset(); setEditing(undefined); }} onSave={(value) => save.mutate(value)} />}
  </main>;
}

function FileCategoryDialog({ category, supportedTypes, busy, error, onClose, onSave }: { category: AdminFileCategory; supportedTypes: string[]; busy: boolean; error: unknown; onClose: () => void; onSave: (value: AdminFileCategory) => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const existing = Boolean(category.id);
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const accept = data.getAll("accept").map(String);
    const value = { ...category,
      id: String(data.get("id")).trim(), labelZhCn: String(data.get("labelZhCn")).trim(), labelEnUs: String(data.get("labelEnUs")).trim(),
      descriptionZhCn: String(data.get("descriptionZhCn")).trim() || undefined, descriptionEnUs: String(data.get("descriptionEnUs")).trim() || undefined,
      accept, maxBytes: Math.round(Number(data.get("maxMegabytes")) * 1_000_000), maxFiles: Number(data.get("maxFiles")),
      allowsUrl: data.get("allowsUrl") === "on", required: category.scope === "source" && data.get("required") === "on",
      enabled: data.get("enabled") === "on", sortOrder: Number(data.get("sortOrder")),
    };
    if (category.enabled && !value.enabled && !await confirm(t("admin.fileCategories.disableConfirm"))) return;
    onSave(value);
  };
  return <ModalFrame labelledBy="file-category-title" busy={busy} onClose={requestClose}>
    <div className="modal-title"><h2 id="file-category-title">{t(existing ? "admin.fileCategories.editTitle" : "admin.fileCategories.createTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>×</button></div>
    <form onSubmit={submit} onChange={markDirty}><div className="voice-form-grid">
      <label><span>{t("admin.formOptions.id")}</span><input name="id" defaultValue={category.id} pattern="[A-Za-z0-9-]{2,64}" maxLength={64} readOnly={existing} required autoComplete="off" spellCheck={false} /></label>
      <label><span>{t("admin.fileCategories.order")}</span><input name="sortOrder" type="number" defaultValue={category.sortOrder} min={0} max={10000} required /></label>
      <label><span>{t("admin.formOptions.labelZh")}</span><input name="labelZhCn" defaultValue={category.labelZhCn} maxLength={100} required /></label>
      <label><span>{t("admin.formOptions.labelEn")}</span><input name="labelEnUs" defaultValue={category.labelEnUs} maxLength={100} required /></label>
      <label><span>{t("admin.formOptions.descriptionZh")}</span><textarea name="descriptionZhCn" defaultValue={category.descriptionZhCn} rows={2} maxLength={300} /></label>
      <label><span>{t("admin.formOptions.descriptionEn")}</span><textarea name="descriptionEnUs" defaultValue={category.descriptionEnUs} rows={2} maxLength={300} /></label>
      <fieldset className="field-wide mime-fieldset"><legend>{t("admin.fileCategories.accept")}</legend><div className="mime-options">{supportedTypes.map((contentType) => <label key={contentType}><input type="checkbox" name="accept" value={contentType} defaultChecked={category.accept.includes(contentType)} /><span translate="no">{contentType}</span></label>)}</div></fieldset>
      <label><span>{t("admin.fileCategories.maxMegabytes")}</span><input name="maxMegabytes" type="number" defaultValue={category.maxBytes / 1_000_000} min={0.001} max={500} step={0.001} required /></label>
      <label><span>{t("admin.fileCategories.maxFiles")}</span><input name="maxFiles" type="number" defaultValue={category.maxFiles} min={1} max={50} required /></label>
    </div>
    <div className="toggle-row"><label><input type="checkbox" name="enabled" defaultChecked={category.enabled} /><span>{t("admin.formOptions.enabled")}</span></label>
      {category.scope === "source" && <label><input type="checkbox" name="required" defaultChecked={category.required} /><span>{t("admin.fileCategories.required")}</span></label>}
      {category.scope === "reference" && <label><input type="checkbox" name="allowsUrl" defaultChecked={category.allowsUrl} /><span>{t("admin.fileCategories.allowsUrl")}</span></label>}
    </div>
    {Boolean(error) && <div className="message error" role="alert">{localizedApiError(error, t)}</div>}
    <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "admin.formOptions.saving" : "common.save")}</button></div></form>
  </ModalFrame>;
}
