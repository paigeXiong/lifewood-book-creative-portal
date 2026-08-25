import type { ConfigOption } from "@lifewood/domain";

export type DisplayConfigOption = ConfigOption & { unavailable?: boolean };

export function mergeLegacyOptions(items: ConfigOption[], previousIds: ReadonlyArray<string | undefined>, unavailableLabel: string): DisplayConfigOption[] {
  const known = new Set(items.map((item) => item.id));
  const legacy = [...new Set(previousIds.filter((id): id is string => Boolean(id) && !known.has(id!)))];
  return [...items, ...legacy.map((id) => ({ id, label: `${unavailableLabel} · ${id}`, unavailable: true }))];
}
