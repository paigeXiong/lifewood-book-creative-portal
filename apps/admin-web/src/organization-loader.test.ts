import { describe, expect, it, vi } from "vitest";
import type { AdminOrganization } from "@lifewood/domain";
import { loadAllOrganizations } from "./organization-loader";

const organization = (index: number): AdminOrganization => ({
  id: `org-${index}`,
  name: `Organization ${index}`,
  active: true,
  memberCount: 0,
  createdAt: "2026-08-27T00:00:00Z",
  updatedAt: "2026-08-27T00:00:00Z",
});

describe("organization selector data", () => {
  it("loads every server page instead of truncating assignments at 100 organizations", async () => {
    const items = Array.from({ length: 205 }, (_, index) => organization(index + 1));
    const loadPage = vi.fn(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: items.length,
    }));

    const result = await loadAllOrganizations(loadPage);

    expect(result).toHaveLength(205);
    expect(result.at(-1)?.id).toBe("org-205");
    expect(loadPage).toHaveBeenCalledTimes(3);
  });
});
