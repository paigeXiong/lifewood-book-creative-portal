import { useConfigRemoval } from "./useConfigRemoval";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, localizedApiError, optionService } from "@lifewood/api-client";
import type { AdminCharacterPreset, CharacterInfo, FormOptions, SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";
import { ModalFrame } from "./ModalFrame";
import { SettingsTabs } from "./SettingsTabs";
import { useUnsavedClose } from "./useUnsavedClose";
import { showAdminToast } from "./Toast";
import "./character-presets.css";

const fields = ["name", "storyRole", "personality", "appearance", "clothing", "emotion", "voiceHint"] as const;
const limits = { name: 80, storyRole: 200, personality: 300, appearance: 300, clothing: 200, emotion: 150, voiceHint: 100 };
const emptyCharacter = (): CharacterInfo => ({ id: "", name: "", roleTypeId: "", ageRangeId: "", genderId: "", storyRole: "", personality: "", appearance: "", clothing: "", emotion: "", voiceHint: "", referenceImages: [], referenceImageUrls: [] });
function imageSource(url: string | null | undefined, base: string) { return url ? url.startsWith("/api/") ? url : new URL(url, new URL(base, window.location.origin)).href : undefined; }

export function CharacterPresetsPage({ locale, imageBase }: { locale: SupportedLocale; imageBase: string }) {
  const { t } = useTranslation(); const client = useQueryClient();
  const [editing, setEditing] = useState<AdminCharacterPreset>();
  const [search, setSearch] = useState(""); const submitting = useRef(false);
  const presets = useQuery({ queryKey: ["admin-character-presets"], queryFn: adminService.listCharacterPresets });
  const options = useQuery({ queryKey: ["form-options", locale], queryFn: () => optionService.getFormOptions(locale) });
  const save = useMutation({
    mutationFn: async ({ value, image }: { value: AdminCharacterPreset; image?: File }) => {
      const saved = await adminService.saveCharacterPreset(value);
      // Retain the acknowledged version if the optional image upload fails, so retrying cannot duplicate a preset.
      setEditing(saved);
      client.setQueryData<AdminCharacterPreset[]>(["admin-character-presets"], current => [...(current ?? []).filter(x => x.id !== saved.id), saved].sort((a,b)=>a.sortOrder-b.sortOrder));
      if (image) return adminService.uploadCharacterPresetImage(saved, image);
      return saved;
    },
    onSuccess: async () => { setEditing(undefined); showAdminToast(t("admin.presets.saved")); await client.invalidateQueries({ queryKey: ["admin-character-presets"] }); },
  });
  const removal = useConfigRemoval(adminService.removeCharacterPreset, () => client.invalidateQueries({ queryKey: ["admin-character-presets"] }));
  const items = presets.data?.filter(x => `${x.zhCn.name} ${x.enUs.name}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <main className="content config-content preset-config">
    <SettingsTabs locale={locale}/>
    <section className="page-toolbar">
      <input className="preset-search" value={search} onChange={e=>setSearch(e.target.value)} aria-label={t("admin.presets.search")} placeholder={t("admin.presets.search")}/>
      <span className="result-count">{t("admin.presets.count", { count: presets.data?.length ?? 0 })}</span>
      <button className="primary push-right" disabled={removal.busy || !options.data || presets.isPending || presets.isError} onClick={()=>{save.reset();setEditing({id:crypto.randomUUID().replaceAll("-",""),zhCn:emptyCharacter(),enUs:emptyCharacter(),enabled:true,sortOrder:100,updatedAt:null});}}>{t("admin.presets.create")}</button>
    </section>
    <p className="config-hint">{t("admin.presets.hint")}</p>
    {(presets.isError || options.isError) && <div className="message error" role="alert">{localizedApiError(presets.error ?? options.error,t)} <button onClick={()=>{void presets.refetch();void options.refetch();}}>{t("admin.presets.reload")}</button></div>}
    {removal.error && <div className="message error" role="alert">{localizedApiError(removal.error, t)}</div>}
    <section className="table-card config-removable">
      {presets.isPending ? <p role="status">{t("common.loading")}</p> : <table><thead><tr><th>{t("admin.presets.character")}</th><th>{t("creative.fields.roleType")}</th><th>{t("admin.voices.order")}</th><th>{t("admin.voices.status")}</th><th>{t("admin.voices.action")}</th></tr></thead>
      <tbody>{items.map(p=><tr key={p.id}>
        <td data-label={t("admin.presets.character")}><div className="preset-identity">{p.imageUrl ? <img src={imageSource(p.imageUrl,imageBase)} alt="" loading="lazy"/> : <span className="preset-initial" aria-hidden="true">{p.zhCn.name.slice(0,1)}</span>}<div><strong>{locale==="zh-CN"?p.zhCn.name:p.enUs.name}</strong><small>{locale==="zh-CN"?p.enUs.name:p.zhCn.name}</small></div></div></td>
        <td data-label={t("creative.fields.roleType")}>{options.data?.roleTypes.find(x=>x.id===p.zhCn.roleTypeId)?.label ?? t("admin.presets.unset")}</td>
        <td data-label={t("admin.voices.order")}>{p.sortOrder}</td>
        <td data-label={t("admin.voices.status")}><span className={p.enabled?"status active":"status inactive"}>{t(p.enabled?"admin.voices.enabled":"admin.voices.disabled")}</span></td>
        <td data-label={t("admin.voices.action")}><div className="config-row-actions"><button disabled={removal.busy || !options.data} onClick={()=>{save.reset();setEditing(p);}}>{t("admin.voices.edit")}</button><button className="config-delete" disabled={removal.busy} onClick={()=>void removal.run(p,locale==="zh-CN"?p.zhCn.name:p.enUs.name,true)}>{t("admin.configRemoval.remove")}</button></div></td>
      </tr>)}</tbody></table>}
      {!presets.isPending && !presets.isError && !items.length && <p className="empty">{t("admin.presets.empty")}</p>}
    </section>
    {editing && options.data && <PresetDialog preset={editing} options={options.data} imageBase={imageBase} busy={save.isPending} error={save.error} onClose={()=>setEditing(undefined)} onSave={async(value,image)=>{if(submitting.current)return;submitting.current=true;try{await save.mutateAsync({value,image});}catch{/* Display the mutation error without discarding edits. */}finally{submitting.current=false;}}}/>}
  </main>;
}

function PresetDialog({ preset, options, imageBase, busy, error, onClose, onSave }: { preset: AdminCharacterPreset; options: FormOptions; imageBase: string; busy: boolean; error: unknown; onClose:()=>void; onSave:(value:AdminCharacterPreset,image?:File)=>Promise<void> }) {
  const { t } = useTranslation(); const [image,setImage]=useState<File>(); const [imageError,setImageError]=useState<string>();
  const [preview,setPreview]=useState<string>();
  useEffect(()=>{if(!image){setPreview(undefined);return;}const url=URL.createObjectURL(image);setPreview(url);return()=>URL.revokeObjectURL(url);},[image]);
  const { markDirty, requestClose }=useUnsavedClose(onClose,t("common.unsavedConfirm"),busy);
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault(); if(busy || imageError)return;
    const data=new FormData(event.currentTarget);
    const localized=(key:"zhCn"|"enUs"):CharacterInfo=>({...preset[key],...Object.fromEntries(fields.map(f=>[f,String(data.get(`${key}.${f}`)??"").trim()])),roleTypeId:String(data.get("roleTypeId")??""),ageRangeId:String(data.get("ageRangeId")??""),genderId:String(data.get("genderId")??"")});
    void onSave({...preset,id:preset.id||crypto.randomUUID().replaceAll("-",""),zhCn:localized("zhCn"),enUs:localized("enUs"),sortOrder:Number(data.get("sortOrder")),enabled:data.get("enabled")==="on"},image);
  };
  return <ModalFrame className="preset-modal" labelledBy="preset-title" busy={busy} onClose={requestClose}>
    <div className="modal-title"><h2 id="preset-title">{t(preset.updatedAt?"admin.presets.edit":"admin.presets.create")}</h2><button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button></div>
    <form onSubmit={submit} onChange={markDirty}>
      <fieldset disabled={busy} className="preset-fields">
        <div className="preset-image-row">{(preview || preset.imageUrl) && <img src={preview ?? imageSource(preset.imageUrl,imageBase)} alt={t("admin.presets.image")}/>}<div className="preset-image-controls"><strong>{t("admin.presets.image")}</strong><label className="preset-upload"><input type="file" accept=".jpg,.jpeg,.png,.webp" aria-label={t("admin.presets.chooseImage")} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.size>5000000||!/^image\/(jpeg|png|webp)$/.test(file.type)){setImageError(t("admin.presets.imageInvalid"));setImage(undefined);return;}setImageError(undefined);setImage(file);}}/><span>{t("admin.presets.chooseImage")}</span></label>{image && <span className="preset-file-name">{image.name}</span>}{(image || imageError) && <button type="button" onClick={()=>{setImage(undefined);setImageError(undefined);}}>{t("admin.presets.cancelImage")}</button>}<small>{t("admin.presets.imageHint")}</small></div></div>
        <div className="preset-meta">{([['roleTypeId',options.roleTypes,'roleType'],['ageRangeId',options.ageRanges,'ageRange'],['genderId',options.genders,'gender']] as const).map(([key,items,label])=><label key={key}><span>{t(`creative.fields.${label}`)}</span><select name={key} defaultValue={preset.zhCn[key]??""}><option value="">{t("admin.presets.unset")}</option>{preset.zhCn[key] && !items.some(x=>x.id===preset.zhCn[key]) && <option value={preset.zhCn[key]}>{t("wizard.unavailableOption")}</option>}{items.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>)}<label><span>{t("admin.voices.order")}</span><input name="sortOrder" type="number" min={0} max={10000} defaultValue={preset.sortOrder} required/></label></div>
        <div className="preset-languages">{(["zhCn","enUs"] as const).map(key=><section key={key}><h3>{t(key==="zhCn"?"admin.presets.chinese":"admin.presets.english")}</h3>{fields.map(field=><label key={field}><span>{t(field === "name" ? "creative.fields.characterName" : `creative.fields.${field}`)}</span>{field==="name"?<input name={`${key}.${field}`} defaultValue={preset[key][field]??""} maxLength={limits[field]} required/>:<textarea name={`${key}.${field}`} defaultValue={preset[key][field]??""} maxLength={limits[field]} rows={2}/>}</label>)}</section>)}</div>
        <label className="preset-enabled"><input name="enabled" type="checkbox" defaultChecked={preset.enabled}/>{t("admin.voices.enabled")}</label>
      </fieldset>
      {(imageError || Boolean(error)) && <div className="message error" role="alert">{imageError ?? localizedApiError(error,t)}</div>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy || Boolean(imageError)}>{t(busy?"admin.voices.saving":"common.save")}</button></div>
    </form>
  </ModalFrame>;
}
