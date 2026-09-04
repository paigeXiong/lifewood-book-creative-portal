import type { BookRecognition } from "@lifewood/domain";

export const recognizedFields = ["title", "authorName", "subtitle", "genreId", "sellingPoint", "synopsis"] as const;

// A result may arrive after typing or clearing a field. Keep both kinds of edits.
export function recognitionUpdates(result: BookRecognition, before: BookRecognition, current: BookRecognition): Partial<BookRecognition> {
  return Object.fromEntries(recognizedFields.filter(key => !before[key].trim() && current[key] === before[key] && result[key].trim()).map(key => [key, result[key]]));
}
