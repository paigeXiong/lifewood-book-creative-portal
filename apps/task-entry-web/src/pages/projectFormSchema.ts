import { z } from "zod";
import type { TaskDraft } from "@lifewood/domain";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function createDraftSchema(t: Translate) {
  const text = (max: number) => z.string().max(max, t("wizard.validation.max", { max }));
  return z.object({
    clientName: text(200), contactName: text(100),
    email: text(254).refine((value) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), t("wizard.validation.email")),
    phone: text(50), brandId: z.string(), projectName: text(200), videoGoalId: z.string(), deadline: z.string(),
    audienceIds: z.array(z.string()).max(30), title: text(200), subtitle: text(200), authorName: text(100), genreId: z.string(),
    sellingPoint: text(150), synopsis: text(600), contentLanguageId: z.string(), videoDurationId: z.string(),
    publishingPlatformIds: z.array(z.string()).max(30),
  });
}

export function createStepSchema(t: Translate) {
  return createDraftSchema(t).superRefine((values, context) => {
    const required: Array<[keyof typeof values, string]> = [
      ["clientName", "clientName"], ["contactName", "contactName"], ["email", "email"],
      ["projectName", "projectName"], ["videoGoalId", "videoGoal"], ["title", "bookTitle"],
      ["authorName", "authorName"], ["genreId", "genre"], ["sellingPoint", "sellingPoint"],
      ["synopsis", "synopsis"], ["contentLanguageId", "contentLanguage"], ["videoDurationId", "duration"],
    ];
    required.forEach(([field, label]) => {
      if (!String(values[field]).trim()) context.addIssue({ code: "custom", path: [field], message: t("wizard.validation.required", { field: t(`wizard.fields.${label}`) }) });
    });
    if (!values.audienceIds.length) context.addIssue({ code: "custom", path: ["audienceIds"], message: t("wizard.validation.chooseOne") });
    if (values.deadline) {
      const today = new Date();
      const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (values.deadline < localToday) context.addIssue({ code: "custom", path: ["deadline"], message: t("wizard.validation.futureDate") });
    }
  });
}

export type ProjectFormValues = z.infer<ReturnType<typeof createDraftSchema>>;

export function isProjectStepComplete(draft: TaskDraft): boolean {
  return Boolean(
    draft.project.clientName.trim() && draft.project.contactName.trim() && draft.project.email.trim() &&
    draft.project.projectName.trim() && draft.project.videoGoalId && draft.project.audienceIds.length &&
    draft.book.title.trim() && draft.book.authorName.trim() && draft.book.genreId && draft.book.sellingPoint.trim() &&
    draft.book.synopsis.trim() && draft.book.contentLanguageId && draft.book.videoDurationId &&
    draft.book.sourceAssets.some((asset) => asset.categoryId === "book-cover") &&
    draft.book.sourceAssets.some((asset) => asset.categoryId === "manuscript")
  );
}
