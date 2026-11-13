/** Page sizes offered by the pagination control (S4). */
export const PAGE_SIZES = [20, 50, 100];

export function totalPages(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize);
}

/** Clamp a 1-based page into the valid range (at least 1). */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages(total, pageSize)));
}

export type PageItem = number | "…";

/**
 * Compact page list for the pagination control: first two, neighbors of
 * the current page, last two, with ellipses where pages are skipped.
 */
export function pageWindow(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const wanted = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter(
      (page) => page >= 1 && page <= total,
    ),
  );
  const sorted = [...wanted].sort((a, b) => a - b);
  const window: PageItem[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    window.push(sorted[index]);
    if (index < sorted.length - 1 && sorted[index + 1] - sorted[index] > 1) {
      window.push("…");
    }
  }
  return window;
}
