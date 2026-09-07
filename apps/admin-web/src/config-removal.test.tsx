// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { adminService, optionService, ApiError } from "@lifewood/api-client";
import type { AdminCharacterPreset, AdminFileCategory, AdminVoiceReference, FormOptions } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { FileCategoryConfigPage } from "./FileCategoryConfigPage";
import { CharacterPresetsPage } from "./CharacterPresetsPage";
import { VoiceConfigPage } from "./VoiceConfigPage";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
for (const locale of ["zh-CN", "en-US"] as const)
for (const kind of ["file", "preset", "voice"] as const)
it(`confirms deletion, preserves errors, and retries with a refreshed version (${kind}, ${locale})`, async () => {
  await i18n.changeLanguage(locale);
  const character = { id: "sample", name: "Sample", storyRole: "", appearance: "", personality: "", referenceImages: [], referenceImageUrls: [] };
  const file: AdminFileCategory = { id: "sample", scope: "source", labelZhCn: "测试", labelEnUs: "Sample", enabled: true, required: false, allowsUrl: false, maxBytes: 10000, maxFiles: 1, accept: ["image/png"], sortOrder: 0, updatedAt: "v1" };
  const preset: AdminCharacterPreset = { id: "sample", zhCn: character, enUs: character, enabled: true, sortOrder: 0, updatedAt: "v1" };
  const voice: AdminVoiceReference = { id: "sample", nameZhCn: "测试", nameEnUs: "Sample", descriptionZhCn: "", descriptionEnUs: "", enabled: true, recommended: false, audioUrl: null, tagIds: [], sortOrder: 0, updatedAt: "v1" };
  let deleted = false, version = "v1";
  vi.spyOn(adminService, "listFileCategories").mockImplementation(async () => deleted ? [] : [{ ...file, updatedAt: version }]);
  vi.spyOn(adminService, "listCharacterPresets").mockImplementation(async () => deleted ? [] : [{ ...preset, updatedAt: version }]);
  vi.spyOn(adminService, "listVoiceReferences").mockImplementation(async () => deleted ? [] : [{ ...voice, updatedAt: version }]);
  vi.spyOn(adminService, "listSupportedFileContentTypes").mockResolvedValue(["image/png"]);
  vi.spyOn(optionService, "getFormOptions").mockResolvedValue({ roleTypes: [], ageRanges: [], genders: [], voiceTags: [] } as unknown as FormOptions);
  const remove = vi.fn(async (item: { updatedAt?: string | null }) => {
    if (version === "v1") { version = "v2"; throw new ApiError({ code: "config.conflict", messageKey: "admin.configRemoval.conflict", retryable: false }); }
    expect(item.updatedAt).toBe("v2"); deleted = true;
  });
  vi.spyOn(adminService, "removeFileCategory").mockImplementation(remove);
  vi.spyOn(adminService, "removeCharacterPreset").mockImplementation(remove);
  vi.spyOn(adminService, "removeVoiceReference").mockImplementation(remove);
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function () { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function () { this.open = false; } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const clickDelete = () => act(async () => { container.querySelector<HTMLButtonElement>(".config-delete")!.click(); });
  const confirm = (accept: boolean) => act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(x => x.textContent === i18n.t(accept ? "common.confirmAction" : "common.cancel"))!.click(); await settle();
  });
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter>{kind === "file" ? <FileCategoryConfigPage locale={locale} /> : kind === "voice" ? <VoiceConfigPage locale={locale} /> : <CharacterPresetsPage locale={locale} imageBase="/" />}</MemoryRouter></QueryClientProvider>); await settle(); });
    for (let i = 0; i < 10 && !container.querySelector("tbody tr"); i++) await act(async () => { await settle(); });
    await clickDelete(); await confirm(false); expect(remove).not.toHaveBeenCalled();
    await clickDelete(); await confirm(true);
    expect(container.textContent).toContain(i18n.t("admin.configRemoval.conflict")); expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await clickDelete(); await confirm(true); expect(remove).toHaveBeenCalledTimes(2); expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks();
    if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});
