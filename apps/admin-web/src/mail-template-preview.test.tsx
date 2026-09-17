// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mailSettingsService, type MailTemplatePreview as Preview } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { MailTemplatePreview } from "./MailTemplatePreview";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const data = (locale: string): Preview[] => ["verify", "reset", "notice", "security"].map(kind => ({ kind, subject: `${locale} ${kind}`, body: { text: `${locale} plain ${kind}`, html: `<!doctype html><html><head></head><body>${locale} ${kind}</body></html>` } }));
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(mailSettingsService, "templates").mockImplementation(async locale => data(locale));
  vi.spyOn(mailSettingsService, "test").mockResolvedValue();
  vi.spyOn(mailSettingsService, "save");
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><MailTemplatePreview locale={locale} /></QueryClientProvider>));
}
async function open() { await act(async () => host.querySelector("button")!.click()); await settle(); }
async function change(index: number, value: string) { await act(async () => { const select = host.querySelectorAll("select")[index]; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`loads on demand with sandboxed HTML and plain text (${locale})`, async () => {
    await mount(locale); expect(mailSettingsService.templates).not.toHaveBeenCalled(); await open();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin"); expect(frame.srcdoc).toContain("default-src 'none'");
    expect(host.querySelector('[role="region"]')!.getAttribute('tabindex')).toBe('0');
    expect(frame.srcdoc).toContain(`${locale} verify`);
    await change(0, "security"); expect(host.querySelector("iframe")!.srcdoc).toContain(`${locale} security`);
    await change(2, "text"); expect(host.querySelector("pre")!.textContent).toBe(`${locale} plain security`);
    expect(mailSettingsService.test).not.toHaveBeenCalled(); expect(mailSettingsService.save).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
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
