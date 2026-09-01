export type PaginationItem = number | "start-ellipsis" | "end-ellipsis";

export function buildPagination(currentPage: number, totalPages: number): PaginationItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.min(total, Math.max(1, Math.floor(currentPage)));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const visible = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 4) for (let page = 2; page <= 5; page += 1) visible.add(page);
  if (current >= total - 3) for (let page = total - 4; page < total; page += 1) visible.add(page);

  const pages = [...visible].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const items: PaginationItem[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous === 2) items.push(previous + 1);
    else if (previous && page - previous > 2) items.push(index === 1 ? "start-ellipsis" : "end-ellipsis");
    items.push(page);
  });
  return items;
}
