// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, mailSettingsService, type MailServiceSettings } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { MailServiceControls } from "./MailServiceControls";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, router: ReturnType<typeof createMemoryRouter>;
const labels = { title: "SMTP", enabled: "Enabled", host: "Host", port: "Port", from: "Sender", username: "Username", password: "Credential", passwordSaved: "Saved", clearPassword: "Clear", publicUrl: "Domain", save: "Save", cancel: "Cancel", test: "Test", testTitle: "Confirm test", testBody: "Send to", testAccepted: "Accepted", saved: "Saved", help: "Help", smtpHelp: "SMTP help", passwordHelp: "Password help", domainHelp: "Domain help", testHelp: "Test help", reload: "Reload" };
const data: MailServiceSettings = { revision: "r1", enabled: true, host: "smtp.example.test", port: 587, from: "sender@example.test", username: "sender", hasPassword: true, publicUrl: "https://portal.example.test", available: true, labels };
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(mailSettingsService, "get").mockResolvedValue(data);
  vi.spyOn(mailSettingsService, "save").mockResolvedValue({ ...data, revision: "r2" });
  vi.spyOn(mailSettingsService, "test").mockResolvedValue();
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount(locale: "zh-CN" | "en-US") {
  await i18n.changeLanguage(locale);
  router = createMemoryRouter([{ path: "*", element: <MailServiceControls locale={locale} /> }]);
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
  await click(i18n.t("mailService.configure"));
}
async function click(text: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!.click()); await settle(); }
async function change(selector: string, value: string) {
  await act(async () => { const field = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`keeps secrets blank and explanations in popovers (${locale})`, async () => {
    await mount(locale);
    expect(host.querySelector<HTMLInputElement>('#mail-password')!.value).toBe("");
    expect(host.querySelector<HTMLInputElement>('#mail-password')!.placeholder).toBe("Saved");
    expect(host.querySelectorAll('[popover="auto"]').length).toBe(6);
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(3);
    expect(mailSettingsService.test).not.toHaveBeenCalled();
  });
  it(`requires explicit test confirmation and uses the saved revision (${locale})`, async () => {
    await mount(locale); await click("Test"); expect(mailSettingsService.test).not.toHaveBeenCalled();
    expect(host.textContent).toContain(data.from); await click("Test");
    expect(mailSettingsService.test).toHaveBeenCalledExactlyOnceWith("r1", locale); expect(host.textContent).toContain("Accepted");
  });
  it(`locks fields and prevents duplicate writes while saving (${locale})`, async () => {
    let resolve!: (value: MailServiceSettings) => void;
    vi.mocked(mailSettingsService.save).mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(locale); await change('#mail-host', 'changed.example.test');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await settle(); expect(mailSettingsService.save).toHaveBeenCalledTimes(1); expect(host.querySelector('fieldset')!.disabled).toBe(true);
    await act(async () => resolve({ ...data, revision: 'r2' })); await settle(); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it(`preserves drafts when a background read fails or a newer revision arrives (${locale})`, async () => {
    await mount(locale); await change('#mail-host', 'unsaved.example.test'); await change('#mail-password', 'unsaved-credential');
    vi.mocked(mailSettingsService.get).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin-mail-settings'] }); }); await settle();
    expect(host.querySelector<HTMLInputElement>('#mail-host')!.value).toBe('unsaved.example.test');
    await act(async () => client.setQueryData(['admin-mail-settings', locale], { ...data, revision: 'newer', host: 'remote.example.test' }));
    expect(host.querySelector<HTMLInputElement>('#mail-password')!.value).toBe('unsaved-credential');
    await click('Save'); expect(mailSettingsService.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 'r1', host: 'unsaved.example.test' }), locale);
  });
}

it("preserves the draft when switching locale fails to load translated settings", async () => {
  function LocaleHarness() { const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN"); return <><button onClick={() => setLocale("en-US")}>Switch locale</button><MailServiceControls locale={locale} /></>; }
  await i18n.changeLanguage("zh-CN");
  router = createMemoryRouter([{ path: "*", element: <LocaleHarness /> }]);
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
  await click(i18n.t("mailService.configure")); await change('#mail-host', 'draft.example.test'); await change('#mail-password', 'draft-secret');
  vi.mocked(mailSettingsService.get).mockRejectedValueOnce(new Error('offline'));
  await click('Switch locale'); await settle();
  expect(host.querySelector<HTMLInputElement>('#mail-host')!.value).toBe('draft.example.test');
  expect(host.querySelector<HTMLInputElement>('#mail-password')!.value).toBe('draft-secret');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

for (const locale of ["zh-CN", "en-US"] as const) it.each(["testAuthentication", "testConnection", "testTimeout", "testTls", "testSecurity", "testRecipient", "testUnavailable", "testFailed"])(`shows safe %s diagnostics with collapsed advice (${locale})`, async code => {
  vi.mocked(mailSettingsService.test).mockRejectedValue(new ApiError({ code: "mailService." + code, messageKey: "mailService.errors." + code, retryable: false, fallbackMessage: "sensitive-diagnostic" }));
  await mount(locale); await click("Test"); await click("Test");
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(i18n.t("mailService.errors." + code));
  expect(host.textContent).not.toContain("sensitive-diagnostic");
  const help = host.querySelector('[popover="auto"]')!;
  expect(help.textContent).toContain(i18n.t("mailService.hints." + code));
  expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull();
  expect(mailSettingsService.test).toHaveBeenCalledTimes(1);
});
