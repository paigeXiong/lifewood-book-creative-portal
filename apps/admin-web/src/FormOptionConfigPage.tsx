import { useConfirm } from "./useConfirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AdminFormOption, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import { SettingsTabs } from "./SettingsTabs";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";
import "./form-option-config.css";

function emptyOption(groupId: string): AdminFormOption {
  return { groupId, id: "", labelZhCn: "", labelEnUs: "", allowsCustomValue: false, enabled: true, sortOrder: 100 };
}

export function FormOptionConfigPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const actionLock = useRef(false);
  const [working, setWorking] = useState(false);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editing, setEditing] = useState<AdminFormOption>();
  const catalogue = useQuery({ queryKey: ["admin-form-option-groups", locale], queryFn: () => adminService.listFormOptionGroups(locale) });
  const sections = catalogue.data ?? [];
  const groups = sections.flatMap(section => section.groups);
  const selected = groups.find(group => group.id === params.get("group")) ?? groups[0];
  const groupId = selected?.id ?? "";
  const section = sections.find(item => item.groups.some(group => group.id === groupId));
  const needle = search.trim().toLocaleLowerCase(locale);
  const matches = sections.map(item => ({
    ...item,
    groups: item.groups.filter(group => !needle || (item.label + " " + group.label).toLocaleLowerCase(locale).includes(needle)),
  })).filter(item => item.groups.length > 0);
  useEffect(() => {
    if (groupId && params.get("group") !== groupId) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("group", groupId); return next; }, { replace: true });
    }
  }, [groupId, params, setParams]);
  const options = useQuery({
    queryKey: ["admin-form-options", groupId],
    queryFn: () => adminService.listFormOptions(groupId),
    enabled: Boolean(groupId),
  });
  const selectGroup = (id: string) => {
    setParams(previous => { const next = new URLSearchParams(previous); next.set("group", id); return next; });
    setMobileOpen(false);
  };
  const save = useMutation({
    mutationFn: adminService.saveFormOption,
    onSuccess: async (_data, value) => {
      setEditing(undefined);
      showAdminToast(t("admin.feedback.optionSaved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-form-options", value.groupId] }),
        queryClient.invalidateQueries({ queryKey: ["form-options"] }),
      ]);
    },
  });
  const filter = params.get("status") === "disabled" ? "disabled" : params.get("status") === "all" ? "all" : "enabled";
  const visibleOptions = (options.data ?? []).filter(option => filter === "all" || option.enabled === (filter === "enabled"));
  const action = useMutation({
    mutationFn: async ({ option, remove }: { option: AdminFormOption; remove: boolean }) => { if(remove) await adminService.removeFormOption(option); else await adminService.saveFormOption({ ...option, enabled: !option.enabled }); },
    onSuccess: async (_result, { option, remove }) => {
      showAdminToast(t(remove ? "admin.formOptions.removed" : "admin.feedback.optionSaved"));
      await Promise.all([queryClient.invalidateQueries({queryKey:["admin-form-options",option.groupId]}),queryClient.invalidateQueries({queryKey:["form-options"]})]);
    },
  });
  const runAction = async (option: AdminFormOption, remove: boolean) => {
    if(actionLock.current)return;
    actionLock.current=true;setWorking(true);action.reset();
    try {
      const name=locale==="zh-CN"?option.labelZhCn:option.labelEnUs;
      if ((remove || option.enabled) && !await confirm(t(remove?"admin.formOptions.removeConfirm":"admin.formOptions.stopConfirm",{name})))return;
      await action.mutateAsync({option,remove});
    } catch { await queryClient.invalidateQueries({queryKey:["admin-form-options",option.groupId]}); }
    finally {actionLock.current=false;setWorking(false);}
  };
  const primaryLabel = t(locale === "zh-CN" ? "admin.formOptions.labelZh" : "admin.formOptions.labelEn");
  const secondaryLabel = t(locale === "zh-CN" ? "admin.formOptions.labelEn" : "admin.formOptions.labelZh");
  return <main className="content config-content form-options-content">
    <SettingsTabs locale={locale} />
    {catalogue.isError && <div className="message error" role="alert">{localizedApiError(catalogue.error, t)} <button type="button" onClick={() => void catalogue.refetch()}>{t("admin.formOptions.retry")}</button></div>}
    {catalogue.isPending && <div className="empty" role="status">{t("admin.formOptions.loading")}</div>}
    {catalogue.isSuccess && <div className="option-workspace">
      <aside className="option-directory" aria-label={t("admin.formOptions.group")}>
        <button className="option-mobile-picker" type="button" aria-expanded={mobileOpen} aria-controls="option-directory-body" onClick={() => setMobileOpen(value => !value)}>
          <span>{selected?.label ?? t("admin.formOptions.group")}</span><span>{t("admin.formOptions.changeGroup")} ⌄</span>
        </button>
        <div id="option-directory-body" className={mobileOpen ? "option-directory-body is-open" : "option-directory-body"}>
          <label className="option-directory-search"><span className="sr-only">{t("admin.formOptions.searchGroups")}</span>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("admin.formOptions.searchGroups")} />
          </label>
          <nav className="option-category-list" aria-label={t("admin.formOptions.group")}>
            {matches.map(item => {
              const open = Boolean(needle) || (expanded[item.id] ?? item.id === section?.id);
              return <section className="option-category" key={item.id}>
                <button className="option-category-toggle" type="button" aria-expanded={open} aria-controls={"option-category-" + item.id} onClick={() => setExpanded(previous => ({ ...previous, [item.id]: !open }))}>
                  <span>{item.label}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
                </button>
                <div id={"option-category-" + item.id} hidden={!open}>
                  {item.groups.map(group => <button type="button" className="option-group-link" aria-current={group.id === groupId ? "page" : undefined} key={group.id} onClick={() => selectGroup(group.id)}>{group.label}</button>)}
                </div>
              </section>;
            })}
            {!matches.length && <p className="option-search-empty" role="status">{t("admin.formOptions.noGroups")}</p>}
          </nav>
        </div>
      </aside>
      <section className="option-results" aria-label={selected?.label}>
        <div className="page-toolbar option-toolbar">
          <div className="option-context"><span>{section?.label}</span><strong>{selected?.label}</strong></div>
          {options.isSuccess && <span className="result-count">{t("admin.formOptions.count", { count: visibleOptions.length })}</span>}
          <select className="option-status-filter" aria-label={t("admin.formOptions.statusFilter")} value={filter} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);if(event.target.value==="enabled")next.delete("status");else next.set("status",event.target.value);return next;})}>
            <option value="enabled">{t("admin.formOptions.enabled")}</option><option value="disabled">{t("admin.formOptions.disabled")}</option><option value="all">{t("admin.formOptions.allStatuses")}</option>
          </select>
          <button className="primary push-right" type="button" disabled={working || !groupId || !options.isSuccess} onClick={() => { save.reset(); setEditing(emptyOption(groupId)); }}>{t("admin.formOptions.create")}</button>
        </div>
        {options.isError && <div className="message error" role="alert">{localizedApiError(options.error, t)} <button type="button" onClick={() => void options.refetch()}>{t("admin.formOptions.retry")}</button></div>}
        {action.isError && action.variables?.option.groupId === groupId && <div className="message error" role="alert">{localizedApiError(action.error,t)}</div>}
        <div className="table-card option-table" aria-busy={options.isFetching}>
          <table><thead><tr><th>{primaryLabel}</th><th>{secondaryLabel}</th><th>{t("admin.formOptions.order")}</th><th>{t("admin.formOptions.status")}</th><th>{t("admin.formOptions.action")}</th></tr></thead>
            <tbody>{visibleOptions.map(option => <tr key={option.id}>
              <td data-label={primaryLabel}><strong>{locale === "zh-CN" ? option.labelZhCn : option.labelEnUs}</strong></td>
              <td data-label={secondaryLabel}>{locale === "zh-CN" ? option.labelEnUs : option.labelZhCn}</td>
              <td className="numeric" data-label={t("admin.formOptions.order")}>{option.sortOrder}</td>
              <td data-label={t("admin.formOptions.status")}><span className={option.enabled ? "status active" : "status inactive"}>{t(option.enabled ? "admin.formOptions.enabled" : "admin.formOptions.disabled")}</span></td>
              <td data-label={t("admin.formOptions.action")}><div className="option-row-actions"><button type="button" disabled={working} onClick={() => { save.reset(); setEditing({ ...option }); }}>{t("admin.formOptions.edit")}</button><button type="button" disabled={working} onClick={()=>void runAction(option,false)}>{t(option.enabled?"admin.formOptions.stop":"admin.formOptions.start")}</button><button className="option-remove" type="button" disabled={working} onClick={()=>void runAction(option,true)}>{t("admin.formOptions.remove")}</button></div></td>
            </tr>)}</tbody>
          </table>
          {options.isPending && <div className="empty" role="status">{t("admin.formOptions.loading")}</div>}
          {options.isSuccess && !visibleOptions.length && <div className="empty">{t("admin.formOptions.empty")}</div>}
        </div>
      </section>
    </div>}
    {editing && <FormOptionDialog option={editing} groupLabel={groups.find(group => group.id === editing.groupId)?.label ?? ""} locale={locale} busy={save.isPending} error={save.error} onClose={() => { save.reset(); setEditing(undefined); }} onSave={value => save.mutate(value)} />}
  </main>;
}

function FormOptionDialog({ option, groupLabel, locale, busy, error, onClose, onSave }: { option: AdminFormOption; groupLabel: string; locale: SupportedLocale; busy: boolean; error: unknown; onClose: () => void; onSave: (option: AdminFormOption) => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const existing = Boolean(option.id);
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
    if (option.enabled && !value.enabled && !await confirm(t("admin.formOptions.disableConfirm"))) return;
    onSave(value);
  };
  return <ModalFrame className="form-option-modal" labelledBy="form-option-dialog-title" busy={busy} onClose={requestClose}>
    <div className="modal-title"><h2 id="form-option-dialog-title">{t(existing ? "admin.formOptions.editTitle" : "admin.formOptions.createTitle")}</h2><button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>×</button></div>
    <div className="option-edit-context"><span>{groupLabel}</span>{existing && <strong>{locale === "zh-CN" ? option.labelZhCn : option.labelEnUs}</strong>}</div>
    <form onSubmit={submit} onChange={markDirty}>
      <div className="option-form-grid">
        <label><span>{t("admin.formOptions.labelZh")}</span><input name="labelZhCn" defaultValue={option.labelZhCn} maxLength={100} required autoComplete="off" /></label>
        <label><span>{t("admin.formOptions.labelEn")}</span><input name="labelEnUs" defaultValue={option.labelEnUs} maxLength={100} required autoComplete="off" /></label>
        <label><span>{t("admin.formOptions.descriptionZh")}</span><textarea name="descriptionZhCn" defaultValue={option.descriptionZhCn} rows={2} maxLength={300} /></label>
        <label><span>{t("admin.formOptions.descriptionEn")}</span><textarea name="descriptionEnUs" defaultValue={option.descriptionEnUs} rows={2} maxLength={300} /></label>
        {option.groupId === "visual-styles" && <label><span>{t("admin.formOptions.previewColor")}</span><input name="previewColor" type="color" defaultValue={option.previewColor ?? "#1f6b50"} /></label>}
        {option.groupId === "visual-styles" && <>
          <label><span>{t("admin.formOptions.previewImageUrl")}</span><input name="previewImageUrl" defaultValue={option.previewImageUrl ?? ""} maxLength={2048} autoComplete="off" spellCheck={false} /></label>
          <label><span>{t("admin.formOptions.previewVideoUrl")}</span><input name="previewVideoUrl" defaultValue={option.previewVideoUrl ?? ""} maxLength={2048} autoComplete="off" spellCheck={false} /></label>
        </>}
        <label><span>{t("admin.formOptions.order")}</span><input name="sortOrder" type="number" inputMode="numeric" defaultValue={option.sortOrder} min={0} max={10000} required autoComplete="off" /></label>
        {!existing && <label><span>{t("admin.formOptions.id")}</span><input name="id" defaultValue={option.id} pattern="[A-Za-z0-9-]{2,64}" maxLength={64} readOnly={existing} required autoComplete="off" spellCheck={false} /></label>}
      </div>
      {existing && <details className="option-advanced"><summary>{t("admin.formOptions.advanced")}</summary><label><span>{t("admin.formOptions.id")}</span><input name="id" value={option.id} readOnly /></label></details>}
      {option.groupId === "video-durations" && <div className="toggle-row"><label><input type="checkbox" name="allowsCustomValue" defaultChecked={option.allowsCustomValue} /><span>{t("admin.formOptions.allowsCustomValue")}</span></label><small>{t("admin.formOptions.allowsCustomValueHint")}</small></div>}
      <div className="toggle-row"><label><input type="checkbox" name="enabled" defaultChecked={option.enabled} /><span>{t("admin.formOptions.enabled")}</span></label></div>
      {Boolean(error) && <div className="message error" role="alert" aria-live="polite">{localizedApiError(error, t)}</div>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "admin.formOptions.saving" : "common.save")}</button></div>
    </form>
  </ModalFrame>;
}
