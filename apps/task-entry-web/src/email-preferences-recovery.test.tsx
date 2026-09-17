import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { EmailSettingsPanel } from "@lifewood/ui/email";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, remount: () => void, changeUser: (user: string) => void, show: (visible: boolean) => void;
const settings = { available: true, email: "test@example.test", verified: true, notifications: false };
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Fixture() {
  const [epoch, setEpoch] = useState(0), [user, setUser] = useState("account"), [visible, setVisible] = useState(true);
  remount = () => setEpoch(value => value + 1); changeUser = setUser; show = setVisible;
  return visible ? <EmailSettingsPanel key={epoch} userId={user} /> : null;
}
beforeEach(() => {
  vi.spyOn(api.emailService, "settings").mockResolvedValue(settings);
  vi.spyOn(api.emailService, "preferences").mockResolvedValue({ ...settings, notifications: true });
  vi.spyOn(api.emailService, "verify").mockResolvedValue();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); onlineManager.setOnline(true); vi.restoreAllMocks(); });
async function mount(locale: string) {
  await i18n.changeLanguage(locale);
  await act(async () => root.render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>)); await settle();
}
function toggle() { return host.querySelector<HTMLInputElement>('[role="switch"]')!; }
function button(key: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === i18n.t(key))!; }
for (const locale of ["zh-CN", "en-US"]) {
  it(`keeps stale controls locked while offline reconciliation is paused (${locale})`, async () => {
    const write = deferred<api.EmailSettings>(), refresh = deferred<api.EmailSettings>();
    vi.mocked(api.emailService.preferences).mockReturnValueOnce(write.promise);
    await mount(locale); await act(async () => toggle().click());
    await act(async () => onlineManager.setOnline(false));
    vi.mocked(api.emailService.settings).mockReturnValue(refresh.promise);
    await act(async () => write.reject(new Error("connection lost"))); await settle();
    expect(client.getQueryState(["email-settings", "account", locale])?.fetchStatus).toBe("paused");
    expect(toggle().disabled).toBe(true); await act(async () => toggle().click());
    expect(api.emailService.preferences).toHaveBeenCalledTimes(1);
    await act(async () => onlineManager.setOnline(true)); await settle(); expect(toggle().disabled).toBe(true);
    await act(async () => refresh.resolve({ ...settings, notifications: true })); await settle();
    expect(toggle().checked).toBe(true); expect(toggle().disabled).toBe(false);
  });
  it(`waits for fresh data when a write completes while the panel is closed (${locale})`, async () => {
    const write = deferred<api.EmailSettings>(), refresh = deferred<api.EmailSettings>();
    vi.mocked(api.emailService.preferences).mockReturnValueOnce(write.promise);
    await mount(locale); await act(async () => toggle().click());
    await act(async () => show(false)); await act(async () => write.resolve({ ...settings, notifications: true })); await settle();
    vi.mocked(api.emailService.settings).mockReturnValue(refresh.promise);
    await act(async () => show(true)); await settle();
    expect(toggle().disabled).toBe(true);
    await act(async () => toggle().click()); expect(api.emailService.preferences).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve({ ...settings, notifications: true })); await settle();
    expect(toggle().checked).toBe(true); expect(toggle().disabled).toBe(false);
  });
  it(`reconciles a lost save response before unlocking even after remount (${locale})`, async () => {
    const write = deferred<api.EmailSettings>(), refresh = deferred<api.EmailSettings>();
    vi.mocked(api.emailService.preferences).mockReturnValueOnce(write.promise);
    await mount(locale); await act(async () => { toggle().click(); toggle().click(); });
    expect(api.emailService.preferences).toHaveBeenCalledExactlyOnceWith(true);
    await act(async () => remount()); await settle(); expect(toggle().disabled).toBe(true);
    vi.mocked(api.emailService.settings).mockReturnValue(refresh.promise);
    await act(async () => write.reject(new Error("response lost"))); await settle();
    expect(toggle().disabled).toBe(true); expect(api.emailService.settings).toHaveBeenCalledTimes(2);
    await act(async () => refresh.resolve({ ...settings, notifications: true })); await settle();
    expect(toggle().checked).toBe(true); expect(toggle().disabled).toBe(false);
    expect(host.textContent).not.toContain(i18n.t("email.saved"));
  });
  it(`refreshes after failed write and allows a deliberate new choice (${locale})`, async () => {
    vi.mocked(api.emailService.preferences).mockRejectedValueOnce(new Error("lost response"));
    await mount(locale); vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, notifications: true });
    await act(async () => toggle().click()); await settle();
    expect(toggle().checked).toBe(true); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(api.emailService.settings).mockResolvedValue(settings);
    await act(async () => toggle().click()); await settle();
    expect(api.emailService.preferences).toHaveBeenLastCalledWith(false); expect(toggle().checked).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it(`requires successful refresh after reconciliation fails (${locale})`, async () => {
    await mount(locale); vi.mocked(api.emailService.settings).mockRejectedValueOnce(new Error("refresh failed"));
    await act(async () => toggle().click()); await settle();
    expect(toggle()).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, notifications: true });
    await act(async () => button("common.retry").click()); await settle();
    expect(toggle().checked).toBe(true); expect(toggle().disabled).toBe(false); expect(api.emailService.preferences).toHaveBeenCalledTimes(1);
  });
  for (const failure of [false, true]) it(`discards late ${failure ? "failure" : "success"} after account event (${locale})`, async () => {
    const write = deferred<api.EmailSettings>(); vi.mocked(api.emailService.preferences).mockReturnValueOnce(write.promise);
    await mount(locale); await act(async () => toggle().click());
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    await act(async () => { if (failure) write.reject(new Error("late")); else write.resolve({ ...settings, notifications: true }); }); await settle();
    expect(toggle().disabled).toBe(true); expect(api.emailService.settings).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("accountSwitch.changed"));
    expect(host.textContent).not.toContain(i18n.t("email.saved"));
  });
  it(`old account completion does not refresh or lock the replacement account (${locale})`, async () => {
    let account = "account";
    vi.spyOn(api, "captureAccountGuard").mockImplementation(() => { const captured = account; return () => { if (captured !== account) throw new Error("account changed"); }; });
    const write = deferred<api.EmailSettings>(); vi.mocked(api.emailService.preferences).mockReturnValueOnce(write.promise);
    await mount(locale); await act(async () => toggle().click());
    account = "other"; await act(async () => changeUser("other")); await settle();
    expect(toggle().disabled).toBe(false);
    const requests = vi.mocked(api.emailService.settings).mock.calls.length;
    await act(async () => write.resolve({ ...settings, notifications: true })); await settle();
    expect(api.emailService.settings).toHaveBeenCalledTimes(requests); expect(toggle().checked).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).not.toContain(i18n.t("email.saved"));
  });
  it(`reconciles a verification request whose response was lost (${locale})`, async () => {
    vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, verified: false });
    vi.mocked(api.emailService.verify).mockRejectedValueOnce(new Error("response lost"));
    await mount(locale); vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, verified: false, deliveryStatus: "pending" });
    await act(async () => button("email.sendVerification").click()); await settle();
    expect(button("email.sendVerification").disabled).toBe(true); expect(api.emailService.verify).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(i18n.t("email.delivery.pending"));
  });
}

for (const locale of ["zh-CN", "en-US"]) it(`saves selected email topics and preserves them while the master switch is off (${locale})`, async () => {
  const topics = [{ id: "completed", label: locale === "en-US" ? "Project completed" : "项目完成", enabled: true }, { id: "returned", label: locale === "en-US" ? "Changes requested" : "退回修改", enabled: true }];
  vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, notifications: true, topics });
  await mount(locale);
  const changed = topics.map(item => ({ ...item, enabled: item.id !== "completed" }));
  vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, notifications: true, topics: changed });
  await act(async () => host.querySelector<HTMLInputElement>('.email-topic-options input')!.click()); await settle();
  expect(api.emailService.preferences).toHaveBeenCalledExactlyOnceWith(true, ["returned"]);
  expect(host.querySelector<HTMLInputElement>('.email-topic-options input')!.checked).toBe(false);
  vi.mocked(api.emailService.settings).mockResolvedValue({ ...settings, notifications: false, topics: changed });
  await act(async () => toggle().click()); await settle();
  expect(host.querySelector<HTMLFieldSetElement>('.email-topic-options')!.disabled).toBe(true);
  expect(host.querySelectorAll<HTMLInputElement>('.email-topic-options input')[1].checked).toBe(true);
});

it("refreshes server topic labels when the mounted profile changes language", async () => {
  vi.mocked(api.emailService.settings).mockImplementation(async locale => ({ ...settings, notifications: true, topics: [{ id: "completed", enabled: true, label: locale === "en-US" ? "Project completed" : "项目完成" }] }));
  await mount("zh-CN"); expect(host.textContent).toContain("项目完成");
  await act(async () => { await i18n.changeLanguage("en-US"); }); await settle();
  expect(host.textContent).toContain("Project completed"); expect(host.textContent).not.toContain("项目完成");
  expect(api.emailService.settings).toHaveBeenLastCalledWith("en-US");
});
