// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mailSettingsService, type MailTemplatePreview as Preview } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { MailTemplatePage } from "./MailTemplatePage";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const data = (locale: string): Preview[] => ["verify", "reset", "notice", "security"].map(kind => ({ kind, introduction: "Body", enabled: true, revision: "default", subject: `${locale} ${kind}`, body: { text: `${locale} plain ${kind}`, html: `<!doctype html><html><head></head><body>${locale} ${kind}</body></html>` } }));
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(async () => {
  const {transferableAbortController}=await vi.importActual<{transferableAbortController:()=>AbortController}>("node:util");
  vi.stubGlobal("AbortController",class {constructor(){return transferableAbortController();}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(mailSettingsService, "templates").mockImplementation(async locale => data(locale));
  vi.spyOn(mailSettingsService, "test").mockResolvedValue();
  vi.spyOn(mailSettingsService, "save");
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={createMemoryRouter([{path:"*",element:<MailTemplatePage locale={locale} allowed={true} />}],{initialEntries:[`/${locale}/settings/mail/templates`]})} /></QueryClientProvider>));
}
async function open() { await settle(); }
async function change(index: number, value: string) { await act(async () => { const select = host.querySelectorAll("select")[index]; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`renders the dedicated page with sandboxed HTML and plain text (${locale})`, async () => {
    await mount(locale); await open();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin"); expect(frame.srcdoc).toContain("default-src 'none'");
    expect(host.querySelector('[role="region"]')!.getAttribute('tabindex')).toBe('0');
    expect(frame.srcdoc).toContain(`${locale} verify`);
    await change(0, "security"); expect(host.querySelector("iframe")!.srcdoc).toContain(`${locale} security`);
    await change(2, "text"); expect(host.querySelector("pre")!.textContent).toBe(`${locale} plain security`);
    expect(mailSettingsService.test).not.toHaveBeenCalled(); expect(mailSettingsService.save).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".mail-template-workspace")).not.toBeNull();
  });
}
it("keeps the selected template when changing languages and ignores late responses", async () => {
  await mount("zh-CN"); await open(); await change(0, "reset");
  let resolve!: (value: Preview[]) => void;
  vi.mocked(mailSettingsService.templates).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await change(1, "en-US"); expect(host.querySelector("iframe")).toBeNull();
  await change(1, "zh-CN");
  await act(async () => resolve(data("en-US"))); await settle();
  expect(host.querySelector("iframe")!.srcdoc).toContain("zh-CN reset");
});
it("shows a recoverable localized read error without exposing raw server text", async () => {
  vi.mocked(mailSettingsService.templates).mockRejectedValueOnce(new Error("private-error"));
  await mount("zh-CN"); await open();
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("private-error");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()); await settle();
  expect(host.querySelector("iframe")).not.toBeNull();
});

it("keeps the edit revision across refetch and guards unsaved changes", async () => {
  const save = vi.spyOn(mailSettingsService, "saveTemplate").mockResolvedValue(data("zh-CN"));
  const send = vi.spyOn(mailSettingsService, "testTemplate").mockResolvedValue();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await mount("zh-CN"); await open();
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === i18n.t("mailEditor.edit"))!.click());
  expect(host.querySelectorAll("select")[0].disabled).toBe(false);
  await act(async () => {
    const input=host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Changed body");
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  expect(host.querySelectorAll("select")[0].disabled).toBe(true);
  await act(async () => { client.setQueryData(["admin-mail-templates", "zh-CN"], data("zh-CN").map(item => ({ ...item, revision: "newer" }))); });
  await act(async () => host.querySelector<HTMLAnchorElement>(".mail-template-page-heading a")!.click());
  expect(confirm).toHaveBeenCalled(); expect(host.querySelector("form")).not.toBeNull();
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
  expect(save).toHaveBeenCalledWith("verify", "zh-CN", expect.objectContaining({ revision: "default", enabled: true }));
  expect(send).not.toHaveBeenCalled();
});

it("retains the editor when a background refresh fails", async () => {
  await mount("zh-CN"); await open();
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === i18n.t("mailEditor.edit"))!.click());
  const input = host.querySelector("textarea");
  vi.mocked(mailSettingsService.templates).mockRejectedValue(new Error("offline"));
  await act(async () => client.refetchQueries({ queryKey: ["admin-mail-templates"] })); await settle();
  expect(host.querySelector("textarea")).toBe(input);
  expect(host.textContent).toContain(i18n.t("recovery.refreshFailed"));
});

it("previews unsaved content without saving or sending", async () => {
  const preview=vi.spyOn(mailSettingsService,"previewTemplate").mockResolvedValue({...data("zh-CN")[0],subject:"Preview title"});
  const save=vi.spyOn(mailSettingsService,"saveTemplate");
  const send=vi.spyOn(mailSettingsService,"testTemplate");
  await mount("zh-CN");await open();
  await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===i18n.t("mailEditor.edit"))!.click());
  await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===i18n.t("mailEditor.preview"))!.click());await settle();
  expect(preview).toHaveBeenCalled();
  expect(host.querySelector(".mail-preview-subject")!.textContent).toContain("Preview title");
  expect(save).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
