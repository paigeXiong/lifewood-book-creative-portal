import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { getNarrationEnabled, normalizeNarration } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import { NarrationChoice } from "./components/NarrationChoice";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("narration choice", () => {
  it("distinguishes an unanswered draft from an explicit opt-out and legacy opt-in", () => {
    expect(getNarrationEnabled({ selectedVoiceIds: [] })).toBeUndefined();
    expect(getNarrationEnabled({ contentLanguageId: "en-US", selectedVoiceIds: [] })).toBeUndefined();
    expect(getNarrationEnabled({ narrationToneId: "warm", selectedVoiceIds: [] })).toBe(true);
    expect(getNarrationEnabled({ narrationEnabled: false, narrationToneId: "warm", selectedVoiceIds: [] })).toBe(false);
  });

  it("does not send inactive narration settings in the handoff", () => {
    expect(normalizeNarration({ narrationEnabled: false, contentLanguageId: "en-US", narrationToneId: "warm", selectedVoiceIds: ["old-voice"], preferredVoiceId: "old-voice" }))
      .toEqual({ narrationEnabled: false, selectedVoiceIds: [] });
    const legacy = { narrationToneId: "warm", selectedVoiceIds: ["old-voice"] };
    expect(normalizeNarration(legacy)).toEqual({ ...legacy, narrationEnabled: true });
  });

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`expands only for yes, with localized choices in ${locale}`, async () => {
      await i18n.changeLanguage(locale);
      function Form() {
        const [value, setValue] = useState<boolean | null>(null);
        return <NarrationChoice value={value} onChange={setValue}><input aria-label="test-setting" /></NarrationChoice>;
      }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        act(() => root.render(<Form />));
        expect(container.querySelector('[aria-label="test-setting"]')).toBeNull();
        const yes = container.querySelector<HTMLInputElement>('input[value="true"]')!;
        const no = container.querySelector<HTMLInputElement>('input[value="false"]')!;
        expect(yes.checked || no.checked).toBe(false);
        expect(container.textContent).toContain(i18n.t("voice.narration.question"));
        act(() => yes.click());
        expect(container.querySelector('[aria-label="test-setting"]')).not.toBeNull();
        act(() => no.click());
        expect(container.querySelector('[aria-label="test-setting"]')).toBeNull();
        expect(container.querySelector('[role="status"]')).toBeNull();
        expect(container.textContent).not.toContain(i18n.t("voice.narration.scope"));
        for (const key of ["voice.narration.question", "voice.narration.yes", "voice.narration.no", "voice.validation.narrationChoice"])
          expect(i18n.getResource(locale, "translation", key)).toBeTypeOf("string");
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  }
});
