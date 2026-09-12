import { preparePhoto } from "./prepare-photo";

export class FeedbackImageError extends Error {}

export async function prepareFeedbackScreenshot(file: File, limits: { sourceMaxBytes: number; storedMaxBytes: number }): Promise<File> {
  if (file.size <= 0 || file.size > limits.sourceMaxBytes || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new FeedbackImageError("invalid_source");
  }
  return preparePhoto(file, {
    id: "feedback", label: "", accept: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: limits.storedMaxBytes, maxFiles: 1, allowsUrl: false, required: false,
  }, { maxEdge: 3200, preferLossless: true });
}
