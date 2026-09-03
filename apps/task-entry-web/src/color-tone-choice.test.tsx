import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { i18n } from "@lifewood/i18n";
import { ColorToneChoice } from "./components/ColorToneChoice";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("color tone choice", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`retains old selections until replaced, permits one server option and clearing in ${locale}`, async () => {
      await i18n.changeLanguage(locale);
      function Form() {
        const [value, setValue] = useState(["old-one", "old-two"]);
        return <><ColorToneChoice value={value} onChange={setValue} options={[
          { id: "server-warm", label: "Server warm" }, { id: "server-cool", label: "Server cool" },
          { id: "old-one", label: "Old one", unavailable: true }, { id: "old-two", label: "Old two", unavailable: true },
        ]} /><output>{JSON.stringify(value)}</output></>;
      }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        act(() => root.render(<Form />));
        expect(container.querySelector("legend")?.textContent).toContain(locale === "zh-CN" ? "色彩基调" : "Color tone");
        expect(container.querySelector("output")?.textContent).toBe('["old-one","old-two"]');
        expect(container.querySelector('[role="status"]')?.textContent).toContain("Old one / Old two");
        expect(container.querySelector('input[value="old-one"]')).toBeNull();
        act(() => container.querySelector<HTMLInputElement>('input[value="server-warm"]')!.click());
        act(() => container.querySelector<HTMLInputElement>('input[value="server-cool"]')!.click());
        expect(container.querySelector("output")?.textContent).toBe('["server-cool"]');
        expect(container.querySelectorAll("input:checked")).toHaveLength(1);
        act(() => container.querySelector<HTMLInputElement>('input[value=""]')!.click());
        expect(container.querySelector("output")?.textContent).toBe("[]");
        for (const key of ["hint", "noPreference", "legacy", "singleSelection"])
          expect(i18n.getResource(locale, "translation", `creative.colorTone.${key}`)).toBeTypeOf("string");
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  }
});
