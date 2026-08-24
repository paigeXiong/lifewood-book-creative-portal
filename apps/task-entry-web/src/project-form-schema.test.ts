import { describe, expect, it } from "vitest";
import { createDraftSchema, createStepSchema } from "./pages/projectFormSchema";

const t = (key: string) => key;
const empty = {
  clientName: "", contactName: "", email: "", phone: "", brandId: "", projectName: "", videoGoalId: "", deadline: "",
  audienceIds: [], title: "", subtitle: "", authorName: "", genreId: "", sellingPoint: "", synopsis: "",
  contentLanguageId: "", videoDurationId: "", publishingPlatformIds: [],
};

describe("project form validation", () => {
  it("allows an incomplete but structurally safe draft", () => {
    expect(createDraftSchema(t).safeParse(empty).success).toBe(true);
  });

  it("requires the completed step before continuing", () => {
    const result = createStepSchema(t).safeParse(empty);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "clientName")).toBe(true);
  });

  it("rejects invalid email and excessive text in a draft", () => {
    const result = createDraftSchema(t).safeParse({ ...empty, email: "bad", synopsis: "x".repeat(601) });
    expect(result.success).toBe(false);
  });
});
