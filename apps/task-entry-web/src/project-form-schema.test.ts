import { describe, expect, it } from "vitest";
import { createDraftSchema, createStepSchema } from "./pages/projectFormSchema";

const t = (key: string) => key;
const empty = {
  clientName: "", contactName: "", email: "", phone: "", brandId: "", projectName: "", videoGoalId: "", deadline: "",
  audienceIds: [], title: "", subtitle: "", authorName: "", genreId: "", sellingPoint: "", synopsis: "",
  contentLanguageId: "", videoDurationId: "", customVideoDuration: "", publishingPlatformIds: [],
};

describe("project form validation", () => {
  it("allows an incomplete but structurally safe draft", () => {
    expect(createDraftSchema(t).safeParse(empty).success).toBe(true);
  });

  it("requires the completed step before continuing", () => {
    const result = createStepSchema(t).safeParse(empty);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "title")).toBe(true);
  });

  it("rejects invalid email and excessive text in a draft", () => {
    const result = createDraftSchema(t).safeParse({ ...empty, email: "bad", synopsis: "x".repeat(601) });
    expect(result.success).toBe(false);
  });

  it("requires a concrete value for a configurable custom duration", () => {
    const complete = { ...empty, clientName: "Client", contactName: "Contact", email: "a@example.com", projectName: "Project", videoGoalId: "goal", audienceIds: ["audience"], title: "Book", authorName: "Author", genreId: "genre", sellingPoint: "Point", synopsis: "Synopsis", contentLanguageId: "en-US", videoDurationId: "custom-duration" };
    const result = createStepSchema(t, ["custom-duration"]).safeParse(complete);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "customVideoDuration")).toBe(true);
  });
});
