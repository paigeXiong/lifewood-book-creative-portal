// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { VoiceSampleControl } from "./VoiceSampleControl";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
for (const locale of ["zh-CN", "en-US"] as const)
it(`handles sample duration, exclusive playback, busy pause, retry and menu (${locale})`, async () => {
  await i18n.changeLanguage(locale);
  const active = createRef<HTMLAudioElement>();
  const remove = vi.fn();
  let reject = false;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (reject) return Promise.reject(new Error("unavailable"));
    this.dispatchEvent(new Event("play")); return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  const render = (busy = false) => act(async () => { root.render(<>{["A", "B"].map(name => <VoiceSampleControl key={name} name={name} src={`/${name}.mp3?v=1`} busy={busy} activeAudio={active} onUpload={() => {}} onRemove={remove} />)}</>); });
  const play = (index: number) => c.querySelectorAll<HTMLButtonElement>(".voice-play")[index];
  try {
    await render(); const samples = c.querySelectorAll("audio");
    await act(async () => { Object.defineProperty(samples[0], "duration", { configurable: true, value: 65 }); samples[0].dispatchEvent(new Event("loadedmetadata")); });
    expect(c.textContent).toContain("1:05");
    await act(async () => play(0).click()); expect(active.current).toBe(samples[0]);
    await act(async () => play(1).click()); expect(active.current).toBe(samples[1]); expect(pause.mock.contexts).toContain(samples[0]);
    expect(play(0).getAttribute("aria-label")).toBe(i18n.t("admin.voices.playSample", { name: "A" }));
    await render(true); expect(play(1).disabled).toBe(false); expect(play(0).disabled).toBe(true);
    await act(async () => play(1).click()); expect(active.current).toBeNull();
    await render(false); reject = true; await act(async () => play(0).click());
    expect(c.textContent).toContain(i18n.t("admin.voices.playbackFailed"));
    reject = false; await act(async () => play(0).click()); expect(load).toHaveBeenCalled(); expect(active.current).toBe(samples[0]);
    const more = c.querySelector<HTMLButtonElement>(".voice-sample-more > button")!;
    await act(async () => more.click()); expect(more.getAttribute("aria-expanded")).toBe("true");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(more.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(more);
    await act(async () => more.click()); await act(async () => c.querySelector<HTMLButtonElement>(".voice-sample-menu button")!.click()); expect(remove).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); expect(active.current).toBeNull(); c.remove(); vi.restoreAllMocks(); }
});
