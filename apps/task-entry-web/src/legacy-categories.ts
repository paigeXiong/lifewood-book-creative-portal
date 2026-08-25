import type { ReferenceAsset, ReferenceCategory } from "@lifewood/domain";

export type DisplayReferenceCategory = ReferenceCategory & { unavailable?: boolean };

export function mergeLegacyCategories(categories: ReferenceCategory[], assets: ReferenceAsset[], unavailableLabel: string): DisplayReferenceCategory[] {
  const known = new Set(categories.map((category) => category.id));
  const missing = [...new Set(assets.map((asset) => asset.categoryId).filter((id) => !known.has(id)))];
  return [...categories, ...missing.map((id) => ({
    id,
    label: `${unavailableLabel} · ${id}`,
    description: unavailableLabel,
    accept: [],
    maxBytes: Math.max(1, ...assets.filter((asset) => asset.categoryId === id).map((asset) => asset.sizeBytes)),
    maxFiles: Math.max(1, assets.filter((asset) => asset.categoryId === id).length),
    allowsUrl: false,
    required: false,
    unavailable: true,
  }))];
}
