import { z } from "zod";
import type { TaskDraft, ProjectInfo } from "@lifewood/domain";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function createDraftSchema(t: Translate) {
  const text = (max: number) => z.string().max(max, t("wizard.validation.max", { max }));
  return z.object({
    clientName: text(200), contactName: text(100),
    email: text(254).refine((value) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), t("wizard.validation.email")),
    phone: text(50), brandId: z.string(), projectName: text(200), videoGoalId: z.string(), deadline: z.string(),
    audienceIds: z.array(z.string()).max(30), title: text(200), subtitle: text(200), authorName: text(100), genreId: z.string(),
    sellingPoint: text(150), synopsis: text(600), contentLanguageId: z.string(), videoDurationId: z.string(), customVideoDuration: text(80),
    publishingPlatformIds: z.array(z.string()).max(30),
  });
}

export function createStepSchema(t: Translate, customDurationOptionIds: string[] = []) {
  return createDraftSchema(t).superRefine((values, context) => {
    const required: Array<[keyof typeof values, string]> = [
      ["title", "bookTitle"],
      ["authorName", "authorName"], ["genreId", "genre"],
      ["contentLanguageId", "contentLanguage"], ["videoDurationId", "duration"],
    ];
    required.forEach(([field, label]) => {
      if (!String(values[field]).trim()) context.addIssue({ code: "custom", path: [field], message: t("wizard.validation.required", { field: t(`wizard.fields.${label}`) }) });
    });
    if (customDurationOptionIds.includes(values.videoDurationId) && !values.customVideoDuration.trim())
      context.addIssue({ code: "custom", path: ["customVideoDuration"], message: t("wizard.validation.customDuration") });

  });
}

export type ProjectFormValues = z.infer<ReturnType<typeof createDraftSchema>>;

export function isProjectStepComplete(draft: TaskDraft): boolean {
  return Boolean(
    draft.book.title.trim() && draft.book.authorName.trim() && draft.book.genreId &&
    draft.book.contentLanguageId && draft.book.videoDurationId &&
    draft.book.sourceAssets.some((asset) => asset.categoryId === "book-cover")
  );
}

export function isProjectBasicsComplete(project: ProjectInfo): boolean {
  return Boolean(project.videoGoalId && project.audienceIds.length);
}
