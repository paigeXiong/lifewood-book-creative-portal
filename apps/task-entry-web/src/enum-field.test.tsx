import { act } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { i18n } from "@lifewood/i18n";
import { EnumField } from "./components/EnumField";
import type { DisplayConfigOption } from "./legacy-options";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("catalog enum choices", () => {
  for (const locale of ["zh-CN", "en-US"]) it(`retains selection, supports catalog updates and clearing in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Example({ items }: { items: DisplayConfigOption[] }) {
      const form = useForm({ defaultValues: { brand: "old" } });
      return <><EnumField htmlFor="brand" label="Brand" items={items} selectedId={form.watch("brand")} registration={form.register("brand")} />
        <output>{form.watch("brand")}</output>
        <button onClick={() => form.reset({ brand: "new" })}>Reset</button></>;
    }
    const items = [{ id: "old", label: "Old", unavailable: true }, { id: "new", label: "New" }];
    try {
      await act(async () => root.render(<Example items={items} />));
      expect(container.querySelector<HTMLInputElement>('input[value="old"]')?.checked).toBe(true);
      expect(container.querySelector<HTMLInputElement>('input[value="old"]')?.disabled).toBe(true);
      expect(container.querySelectorAll("select, input[type=text]")).toHaveLength(0);
      await act(async () => root.render(<Example items={[...items, { id: "added", label: "Added by admin" }]} />));
      await act(async () => container.querySelector<HTMLInputElement>('input[value="added"]')!.click());
      expect(container.querySelector("output")?.textContent).toBe("added");
      await act(async () => container.querySelector<HTMLInputElement>('input[value=""]')!.click());
      expect(container.querySelector("output")?.textContent).toBe("");
      expect(container.textContent).toContain(locale === "zh-CN" ? "不指定" : "No preference");
      await act(async () => root.render(<Example items={[...items,...Array.from({length:10},(_,i)=>({id:"item-"+i,label:"Option "+i}))]} />));
      const search=container.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async()=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"Option 7");
        search.dispatchEvent(new Event("input",{bubbles:true}));
      });
      expect(container.querySelector<HTMLInputElement>('input[value="old"]')!.closest("label")!.hidden).toBe(true);
      expect(container.querySelector<HTMLInputElement>('input[value="item-7"]')!.closest("label")!.hidden).toBe(false);
      expect(container.querySelector<HTMLInputElement>('input[value=""]')!.checked).toBe(true);
      expect(container.querySelector<HTMLInputElement>('input[value=""]')!.closest("label")!.hidden).toBe(false);
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector<HTMLInputElement>('input[value="new"]')?.checked).toBe(true);
      expect(container.querySelector("fieldset")?.classList.contains("field-wide")).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
