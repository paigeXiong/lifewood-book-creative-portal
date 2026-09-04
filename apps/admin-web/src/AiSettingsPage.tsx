import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError, type AiSettings, type AiProvider, type AiProviderInput, type AiBinding } from "@lifewood/api-client";
import type { SupportedLocale } from "@lifewood/domain";
import { SettingsTabs } from "./SettingsTabs";
import { ModalFrame } from "./ModalFrame";
import { showAdminToast } from "./Toast";
import { isAiSettings, requireAiSettings } from "./ai-settings-data";

export function AiSettingsPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["admin-ai-settings", "providers-models-v3", locale];
  const query = useQuery({ queryKey, queryFn: async () => requireAiSettings(await adminService.getAiSettings(locale)) });
  const [section, setSection] = useState<"providers" | "business">("providers");
  const [form, setForm] = useState<AiProviderInput>();
  const [binding, setBinding] = useState<AiBinding>();
  const [deleting, setDeleting] = useState<AiProvider>();
  const applied = (value: AiSettings) => {
    client.setQueryData(queryKey, value); setForm(undefined); setBinding(undefined); setDeleting(undefined);
    showAdminToast(value.labels.saved);
  };
  const save = useMutation({ mutationFn: async (value: AiProviderInput) => requireAiSettings(await adminService.upsertAiProvider(value, locale)), onSuccess: applied });
  const bind = useMutation({ mutationFn: async (value: AiBinding) => requireAiSettings(await adminService.updateAiBinding(value, locale)), onSuccess: applied });
  const remove = useMutation({ mutationFn: async (id: string) => requireAiSettings(await adminService.deleteAiProvider(id, locale)), onSuccess: applied });
  const data = isAiSettings(query.data) ? query.data : undefined;
  const labels = data?.labels;
  const edit = (provider?: AiProvider) => {
    save.reset();
    setForm({ id: provider?.id, name: provider?.name ?? "", protocol: provider?.protocol ?? data!.protocols[0].id,
      endpoint: provider?.endpoint ?? "", model: "", models: provider?.models ?? [], apiKey: "", clearApiKey: false });
  };
  const errorMessage = (error: Error | null) => error && "details" in error && (error.details as { code?: string }).code === "validation.failed"
    ? labels!.invalid : localizedApiError(error, t);
  const submit = (event: FormEvent) => { event.preventDefault(); if (form) save.mutate({ ...form, models: form.models.map(m => m.trim()).filter(Boolean) }); };
  return <main className="content config-content">
    <SettingsTabs locale={locale} />
    {query.isPending && <div role="status">{t("common.loading")}</div>}
    {(query.isError || (query.data && !data)) && <div className="message error" role="alert">{query.isError ? localizedApiError(query.error, t) : t("errors.network.invalidResponse")} <button disabled={query.isFetching} onClick={() => void query.refetch()}>{t("common.retry")}</button></div>}
    {data && labels && <>
      <nav className="ai-section-tabs" aria-label={labels.title}>
        <button aria-pressed={section === "providers"} onClick={() => setSection("providers")}>{labels.providers}</button>
        <button aria-pressed={section === "business"} onClick={() => setSection("business")}>{labels.business}</button>
      </nav>
      {section === "providers" ? <section className="runtime-card">
        <div className="runtime-card-heading"><h2>{labels.providers}</h2><button className="primary" onClick={() => edit()}>{labels.add}</button></div>
        {data.providers.length === 0 ? <div className="center-state compact">{labels.empty}</div> :
          <div className="ai-provider-list">{data.providers.map(provider => {
            const used = data.bindings.some(b => b.providerId === provider.id);
            return <article className="ai-provider-card" key={provider.id}>
              <div className="ai-provider-description"><strong>{provider.name}</strong><span>{data.protocols.find(p => p.id === provider.protocol)?.label}</span><small>{provider.endpoint || labels.keyEmpty}</small><div className="ai-model-tags">{provider.models.map(model => <span key={model}>{model}</span>)}</div></div>
              <span className="status">{provider.hasApiKey ? labels.keySet : labels.keyEmpty}</span>
              <div className="ai-provider-actions"><button onClick={() => edit(provider)}>{labels.edit}</button>
                <button disabled={used} title={used ? labels.inUse : undefined} onClick={() => { remove.reset(); setDeleting(provider); }}>{labels.delete}</button></div>
            </article>;
          })}</div>}
      </section> : <section className="runtime-card">
        <div className="runtime-card-heading"><h2>{labels.business}</h2></div>
        <div className="ai-provider-list">{data.bindings.map(feature => <article className="ai-provider-card" key={feature.featureId}>
          <div className="ai-provider-description"><strong>{feature.label}</strong><span>{data.providers.find(p => p.id === feature.providerId)?.name ?? labels.none}</span><small>{feature.model || labels.keyEmpty}</small></div>
          <span className="status">{feature.enabled ? labels.on : labels.off}</span>
          <button onClick={() => { bind.reset(); setBinding({ ...feature }); }}>{labels.configureFeature}</button>
        </article>)}</div>
      </section>}
    </>}
    {form && data && labels && <ModalFrame labelledBy="ai-settings-title" busy={save.isPending} onClose={() => setForm(undefined)}>
      <h2 id="ai-settings-title">{form.id ? labels.edit : labels.add}</h2>
      <form className="ai-settings-form" onSubmit={submit}>
        <label>{labels.name}<input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>{labels.protocol}<select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })}>{data.protocols.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>{labels.endpoint}<input type="url" required maxLength={2000} value={form.endpoint} placeholder={data.protocols.find(p => p.id === form.protocol)?.endpointPlaceholder} onChange={e => setForm({ ...form, endpoint: e.target.value })} autoComplete="off" /><small>{labels.endpointHint}</small></label>
        <label>{labels.models}<textarea rows={4} value={form.models.join("\n")} onChange={e => setForm({ ...form, models: e.target.value.split("\n") })} /><small>{labels.modelsHint}</small></label>
        <label>{labels.key}<input type="password" maxLength={4096} autoComplete="new-password" value={form.apiKey} disabled={form.clearApiKey} placeholder={data.providers.find(p => p.id === form.id)?.hasApiKey ? labels.keyHint : undefined} onChange={e => setForm({ ...form, apiKey: e.target.value })} /></label>
        {data.providers.find(p => p.id === form.id)?.hasApiKey && <label><input type="checkbox" checked={form.clearApiKey} onChange={e => setForm({ ...form, clearApiKey: e.target.checked, apiKey: "" })} />{labels.clear}</label>}
        {save.isError && <div className="message error" role="alert">{errorMessage(save.error)}</div>}
        <div className="runtime-actions"><button type="button" disabled={save.isPending} onClick={() => setForm(undefined)}>{labels.cancel}</button><button className="primary" disabled={save.isPending}>{labels.save}</button></div>
      </form>
    </ModalFrame>}
    {binding && data && labels && <ModalFrame labelledBy="ai-binding-title" busy={bind.isPending} onClose={() => setBinding(undefined)}>
      <h2 id="ai-binding-title">{binding.label}</h2>
      <form className="ai-settings-form" onSubmit={event => { event.preventDefault(); bind.mutate(binding); }}>
        <label>{labels.provider}<select required={binding.enabled} value={binding.providerId ?? ""} onChange={e => setBinding({ ...binding, providerId: e.target.value || null, model: "" })}>
          <option value="">{labels.none}</option>{data.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label>{labels.model}<select required={binding.enabled} value={binding.model} disabled={!binding.providerId} onChange={e => setBinding({ ...binding, model: e.target.value })}><option value="">{labels.none}</option>{(data.providers.find(p => p.id === binding.providerId)?.models ?? []).map(model => <option key={model} value={model}>{model}</option>)}</select><small>{labels.modelHint}</small></label>
        <label><input type="checkbox" checked={binding.enabled} onChange={e => setBinding({ ...binding, enabled: e.target.checked })} />{labels.enabledFeature}</label>
        {bind.isError && <div className="message error" role="alert">{errorMessage(bind.error)}</div>}
        <div className="runtime-actions"><button type="button" disabled={bind.isPending} onClick={() => setBinding(undefined)}>{labels.cancel}</button><button className="primary" disabled={bind.isPending}>{labels.save}</button></div>
      </form>
    </ModalFrame>}
    {deleting && labels && <ModalFrame labelledBy="ai-delete-title" busy={remove.isPending} onClose={() => setDeleting(undefined)}>
      <h2 id="ai-delete-title">{labels.deleteConfirm}</h2><p>{deleting.name}</p>
      {remove.isError && <div className="message error" role="alert">{errorMessage(remove.error)}</div>}
      <div className="runtime-actions"><button disabled={remove.isPending} onClick={() => setDeleting(undefined)}>{labels.cancel}</button><button disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>{labels.delete}</button></div>
    </ModalFrame>}
  </main>;
}
