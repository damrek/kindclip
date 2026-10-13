import type { ClippingFilter, ClippingRow } from "./types";

/** Page sizes offered by the pagination control (S4). */
export const PAGE_SIZES = [20, 50, 100];

export function emptyFilter(): ClippingFilter {
  return { query: "", bookId: null, kind: null, favoritesOnly: false };
}

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

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel: () => void;
}

/** Trailing-edge debounce for the search input. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/** "p. 12 · pos. 234-236" style reference line for a card. */
export function formatReference(page: number | null, location: string | null): string {
  const parts: string[] = [];
  if (page !== null) {
    parts.push(`p. ${page}`);
  }
  if (location !== null && location !== "") {
    parts.push(`pos. ${location}`);
  }
  return parts.join(" · ");
}

/** Optimistic favorite flip for the visible page (T6). */
export function applyFavoriteToggle(
  items: ClippingRow[],
  id: number,
  favorite: boolean,
): ClippingRow[] {
  return items.map((item) => (item.id === id ? { ...item, favorite } : item));
}

/** Copy card content to the clipboard; `false` when the write fails (T9). */
export async function copyClippingContent(
  write: (text: string) => Promise<void>,
  text: string,
): Promise<boolean> {
  try {
    await write(text);
    return true;
  } catch {
    return false;
  }
}

/** Human date for a card in the given locale; falls back to the raw Kindle string. */
export function formatAddedOn(addedOn: string | null, raw: string, locale?: string): string {
  if (addedOn === null) {
    return raw;
  }
  const date = new Date(addedOn);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const day = date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}
