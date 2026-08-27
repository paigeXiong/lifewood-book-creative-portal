import { adminService } from "@lifewood/api-client";
import type { AdminOrganization, PagedResult } from "@lifewood/domain";

export type OrganizationPageLoader = (query: { page: number; pageSize: number }) => Promise<PagedResult<AdminOrganization>>;

export async function loadAllOrganizations(loadPage: OrganizationPageLoader = adminService.listOrganizations): Promise<AdminOrganization[]> {
  const pageSize = 100;
  const first = await loadPage({ page: 1, pageSize });
  const pageCount = Math.ceil(first.total / pageSize);
  if (pageCount <= 1) return first.items;
  const remaining = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => loadPage({ page: index + 2, pageSize })),
  );
  return [first, ...remaining].flatMap((page) => page.items);
}
