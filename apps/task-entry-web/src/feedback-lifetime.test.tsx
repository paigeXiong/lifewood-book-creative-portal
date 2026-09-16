import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, feedbackService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import { FeedbackButton } from "./components/FeedbackButton";
import { prepareFeedbackScreenshot } from "./prepare-feedback-screenshot";

vi.mock("./prepare-feedback-screenshot", () => ({ prepareFeedbackScreenshot: vi.fn(async (file: File) => file), FeedbackImageError: class extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const screenshot = new File(["picture"], "screen.png", { type: "image/png" });
const catalog = { categories: [{ id: "bug", label: "Bug" }], statuses: [], screenshotMaxBytes: 1_000_000, screenshotSourceMaxBytes: 10_000_000 };
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.mocked(prepareFeedbackScreenshot).mockReset().mockImplementation(async file => file);
  vi.spyOn(feedbackService, "submit").mockResolvedValue(undefined);
  vi.spyOn(feedbackService, "catalog").mockResolvedValue(catalog);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["current-user"], { id: "account" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, value] of [["showModal", show], ["close", close]] as const) { if (value) Object.defineProperty(HTMLDialogElement.prototype, name, value); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); }
});
async function mount(locale: "zh-CN" | "en-US", userId = "account") {
  await act(async () => { await i18n.changeLanguage(locale); client.setQueryData(["feedback-catalog", locale], catalog); });
  await act(async () => root.render(<QueryClientProvider client={client}><FeedbackButton locale={locale} userId={userId} /></QueryClientProvider>));
}
async function open() { await act(async () => host.querySelector<HTMLButtonElement>(".feedback-trigger")!.click()); }
async function describe() {
  const field = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "My feedback draft"); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function choose() {
  const field = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field, "files", { configurable: true, value: [screenshot] });
  await act(async () => field.dispatchEvent(new Event("change", { bubbles: true })));
}
function submit() { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
async function cancel() { await act(async () => host.querySelector<HTMLButtonElement>('footer button[type="button"]')!.click()); }
for (const locale of ["zh-CN", "en-US"] as const) {
  it(`sends one request and retries the identical screenshot payload after timeout (${locale})`, async () => {
    const send = deferred<void>(); vi.mocked(feedbackService.submit).mockReturnValueOnce(send.promise);
    await mount(locale); await open(); await describe(); await choose(); await settle();
    await act(async () => { submit(); submit(); });
    expect(feedbackService.submit).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(feedbackService.submit).mock.calls[0][0]; expect(payload.screenshotBase64).toBe(btoa("picture"));
    await act(async () => send.reject(new ApiError({ code: "feedback.timeout", messageKey: "feedback.timeout", retryable: true })));
    expect(host.querySelector(".feedback-image-preview img")).not.toBeNull();
    await cancel(); await open(); await act(async () => submit());
    expect(vi.mocked(feedbackService.submit).mock.calls[1][0]).toEqual(payload);
    expect(host.textContent).toContain(i18n.t("feedback.submitted"));
  });
  it(`lets users close during processing and ignores the abandoned image (${locale})`, async () => {
    const preparation = deferred<File>(); vi.mocked(prepareFeedbackScreenshot).mockReturnValueOnce(preparation.promise);
    await mount(locale); await open(); await describe(); await choose();
    await act(async () => submit()); expect(feedbackService.submit).not.toHaveBeenCalled();
    await cancel(); expect(host.querySelector("form")).toBeNull(); await open();
    expect(host.querySelector("textarea")!.value).toBe("My feedback draft");
    await act(async () => preparation.resolve(screenshot)); await settle();
    expect(host.querySelector(".feedback-image-preview")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
  it(`clears private input on cross-tab change and ignores the old send result (${locale})`, async () => {
    const send = deferred<void>(); vi.mocked(feedbackService.submit).mockReturnValueOnce(send.promise);
    await mount(locale); await open(); await describe(); await act(async () => submit());
    await act(async () => window.dispatchEvent(new Event("lw-account-changed")));
    expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain(i18n.t("accountSwitch.changed"));
    await act(async () => send.resolve());
    expect(host.textContent).not.toContain(i18n.t("feedback.submitted"));
    expect(host.querySelector<HTMLButtonElement>(".feedback-trigger")!.disabled).toBe(true);
  });
  it(`isolates an old image from a replacement account (${locale})`, async () => {
    const preparation = deferred<File>(); vi.mocked(prepareFeedbackScreenshot).mockReturnValueOnce(preparation.promise);
    await mount(locale); await open(); await describe(); await choose();
    await act(async () => client.setQueryData(["current-user"], { id: "replacement" }));
    await mount(locale, "replacement"); await open();
    await act(async () => preparation.resolve(screenshot)); await settle();
    expect(host.querySelector("textarea")!.value).toBe(""); expect(host.querySelector(".feedback-image-preview")).toBeNull();
    expect(feedbackService.submit).not.toHaveBeenCalled();
  });
  it(`aborts the file reader on close without showing a late error (${locale})`, async () => {
    let reader!: { onabort?: () => void; readAsDataURL: () => void; abort: () => void };
    const abort = vi.fn();
    vi.stubGlobal("FileReader", class { onabort?: () => void; constructor() { reader = this; } readAsDataURL() {} abort() { abort(); this.onabort?.(); } });
    await mount(locale); await open(); await describe(); await choose();
    expect(reader).toBeDefined(); await cancel(); await open();
    expect(abort).toHaveBeenCalledOnce(); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
  it(`blocks submission when the catalog refresh fails and recovers by reading (${locale})`, async () => {
    await mount(locale); await open(); await describe();
    vi.mocked(feedbackService.catalog).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["feedback-catalog", locale] }); }); await settle();
    await act(async () => submit()); expect(feedbackService.submit).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()); await settle();
    expect(host.querySelector("textarea")!.value).toBe("My feedback draft");
    expect(feedbackService.submit).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
}
