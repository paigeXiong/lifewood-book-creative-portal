import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskDraft } from "@lifewood/domain";
import { RevisionSnapshotDetails } from "./ProjectsPage";
import { describe, expect, it } from "vitest";
import { readRevisionSnapshot } from "./revision-snapshot";

describe("revision snapshot labels", () => {
  it.each(["zh-CN", "en-US"] as const)("renders preferred and selected voices from the saved names in %s", locale => {
    const fields = {
      project: { clientName: "", contactName: "", email: "", projectName: "", audienceIds: [] }, book: { title: "", authorName: "", sellingPoint: "", synopsis: "", sourceAssets: [], publishingPlatformIds: [], genreId: "art" },
      creative: { visualStyleId: "style-id", styleReferenceImages: [], characters: [], moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [] },
      voiceAndReferences: { voiceover: { narrationEnabled: true, preferredVoiceId: "preferred-id", selectedVoiceIds: ["selected-id"] }, creativeDirection: { coreMessage: "" }, competitorUrls: [], assets: [] },
    };
    const snapshot = JSON.stringify({ ...fields, configuration: {
      formOptions: [{ groupId: "genres", id: "art", labelZhCn: "历史艺术", labelEnUs: "Historical art" }, { groupId: "visual-styles", id: "style-id", labelZhCn: "历史风格", labelEnUs: "Historical style" }],
      voices: [
        { id: "preferred-id", nameZhCn: "历史首选", nameEnUs: "Historical preferred" },
        { id: "selected-id", nameZhCn: "历史备选", nameEnUs: "Historical selected" },
      ],
    } });
    const html = renderToStaticMarkup(createElement(RevisionSnapshotDetails, {
      snapshot, locale, task: { id: "project", status: "submitted", version: 1, createdAt: "", updatedAt: "", ...fields } satisfies TaskDraft,
    }));
    expect(html).toContain(locale === "zh-CN" ? "历史首选" : "Historical preferred");
    expect(html).toContain(locale === "zh-CN" ? "历史备选" : "Historical selected");
    expect(html).toContain(locale === "zh-CN" ? "历史艺术" : "Historical art");
    expect(html).toContain(locale === "zh-CN" ? "历史风格" : "Historical style");
    expect(html).not.toContain("style-id");
    expect(html).not.toContain("preferred-id");
    expect(html).not.toContain("selected-id");
  });

  it.each(["zh-CN", "en-US"] as const)("keeps saved option and voice names in %s, including retired options", locale => {
    const original = {
      project: {}, book: { genreId: "art" }, creative: {}, voiceAndReferences: {},
      configuration: {
        formOptions: [{ groupId: "genres", id: "art", labelZhCn: "原艺术", labelEnUs: "Original art", enabled: false }],
        voices: [{ id: "voice", nameZhCn: "原音色", nameEnUs: "Original voice" }],
      },
    };
    const saved = JSON.stringify(original);
    original.configuration.formOptions[0].labelZhCn = "改名";
    original.configuration.formOptions[0].labelEnUs = "Renamed";
    original.configuration.voices[0].nameZhCn = "新音色";
    original.configuration.voices[0].nameEnUs = "New voice";
    const historical = readRevisionSnapshot(saved, locale);
    expect(historical.optionMaps.get("genres")?.get("art")).toBe(locale === "zh-CN" ? "原艺术" : "Original art");
    expect(historical.voiceNames.get("voice")).toBe(locale === "zh-CN" ? "原音色" : "Original voice");
    expect(historical.fields.book.genreId).toBe("art");
  });

  it("leaves legacy labels unresolved instead of fabricating current names", () => {
    for (const configuration of [undefined, null]) {
      const saved = readRevisionSnapshot(JSON.stringify({ project: {}, book: { genreId: "old" }, creative: {}, voiceAndReferences: {}, configuration }), "en-US");
      expect(saved.optionMaps.size).toBe(0);
      expect(saved.voiceNames.size).toBe(0);
      expect(saved.fields.book.genreId).toBe("old");
    }
  });
});
