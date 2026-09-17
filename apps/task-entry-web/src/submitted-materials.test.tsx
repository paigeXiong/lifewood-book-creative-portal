import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { MaterialSection, MaterialsControls, MaterialsLink, SubmittedMaterials } from "./components/SubmittedMaterials";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

async function mount(locale: "zh-CN" | "en-US", hash = "") {
  await i18n.changeLanguage(locale);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Fixture({ project }: { project: string }) {
    const navigate = useNavigate();
    return <><button data-back onClick={() => navigate(-1)}>Back</button><SubmittedMaterials key={project} ids={["project", "book", "creative", "voice", "character-one"]}>
      <MaterialsLink id="creative">{i18n.t("taskDetail.creative")}</MaterialsLink>
      <MaterialsLink id="voice">{i18n.t("taskDetail.voice")}</MaterialsLink>
      <MaterialsControls />
      <MaterialSection id="project" title={i18n.t("taskDetail.project")}>Contact</MaterialSection>
      <MaterialSection id="book" title={i18n.t("taskDetail.book")}>Book</MaterialSection>
      <MaterialSection id="creative" title={i18n.t("taskDetail.creative")}><MaterialSection id="character-one" character title="Character one"><a href="/reference">Reference</a><p>All character fields</p></MaterialSection></MaterialSection>
      <MaterialSection id="voice" title={i18n.t("taskDetail.voice")}>Narration</MaterialSection>
    </SubmittedMaterials></>;
  }
  const render = async (project = "one") => { await act(async () => root.render(<MemoryRouter initialEntries={[`/${locale}/tasks/one${hash}`]}><Fixture project={project} /></MemoryRouter>)); };
  await render();
  return {
    host, render,
    open: (id: string) => host.querySelector(`#details-${id}-title`)?.getAttribute("aria-expanded") === "true",
    click: async (selector: string) => { await act(async () => host.querySelector<HTMLElement>(selector)!.click()); },
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

for (const locale of ["zh-CN", "en-US"] as const) {
  it(`keeps full materials available through group and bulk controls (${locale})`, async () => {
    const page = await mount(locale);
    try {
      expect(page.open("project")).toBe(true); expect(page.open("book")).toBe(true); expect(page.open("creative")).toBe(false);
      expect(page.host.querySelector<HTMLElement>("#details-creative-body")?.hidden).toBe(true);
      await page.click(".detail-display-controls button:first-child");
      expect(page.open("character-one")).toBe(true); expect(page.open("voice")).toBe(true);
      expect(page.host.textContent).toContain("All character fields");
      expect(page.host.querySelector(".detail-display-controls")?.textContent).toContain(i18n.t("taskDetail.collapseAll"));
      await page.click(".detail-display-controls button:last-child");
      expect(page.open("project")).toBe(false); expect(page.open("character-one")).toBe(false);
      await page.click("#details-creative-title"); await page.click("#details-character-one-title");
      expect(page.open("character-one")).toBe(true);
      await page.render(); expect(page.open("character-one")).toBe(true);
      await page.render("two"); expect(page.open("character-one")).toBe(false); expect(page.open("project")).toBe(true);
    } finally { await page.close(); }
  });

  it(`opens deep links, focuses their headings, and reopens the same anchor after collapsing (${locale})`, async () => {
    const page = await mount(locale, "#details-character-one");
    try {
      expect(page.open("creative")).toBe(true); expect(page.open("character-one")).toBe(true);
      expect(document.activeElement?.id).toBe("details-character-one-title");
      await page.click('a[href$="#details-voice"]'); expect(page.open("voice")).toBe(true);
      expect(document.activeElement?.id).toBe("details-voice-title");
      await page.click("#details-voice-title"); expect(page.open("voice")).toBe(false);
      await page.click('a[href$="#details-voice"]'); expect(page.open("voice")).toBe(true);
      await page.click('a[href$="#details-creative"]');
      await page.click("#details-voice-title"); expect(page.open("voice")).toBe(false);
      await page.click("[data-back]"); expect(page.open("voice")).toBe(true);
      expect(document.activeElement?.id).toBe("details-voice-title");
    } finally { await page.close(); }
  });
}
