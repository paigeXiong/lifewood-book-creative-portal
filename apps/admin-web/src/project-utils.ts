import type { SupportedLocale } from "@lifewood/domain";
export function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function adminAssetUrl(projectId: string, url: string) {
  const fileId = url.split("/").at(-1);
  return fileId
    ? `/api/admin/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
    : undefined;
}

export function resolveProjectSelection(
  requestedId: string | undefined,
  itemIds: readonly string[],
  hasLoaded: boolean,
): string | undefined {
  if (!hasLoaded) return requestedId;
  if (requestedId) return requestedId;
  if (!itemIds.length) return undefined;
  return itemIds[0];
}

