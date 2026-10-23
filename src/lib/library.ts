import type { Book, ClippingFilter, ClippingRow, Tag } from "./types";

/** Page sizes offered by the pagination control (S4). */
export const PAGE_SIZES = [20, 50, 100];

export function emptyFilter(): ClippingFilter {
  return {
    query: "",
    bookId: null,
    kinds: [],
    favoritesOnly: false,
    editedOnly: false,
    tagIds: [],
  };
}

/** Library-wide clipping count for the "All books" badge (not the filtered total). */
export function totalClippings(books: Book[]): number {
  return books.reduce((sum, book) => sum + book.clipping_count, 0);
}

export type BookSortKey = "title" | "author";
export type BookSortDir = "asc" | "desc";

function normalizeSortArgs(
  sortBy?:
    | BookSortKey
    | {
        sortBy?: BookSortKey;
        sort?: BookSortKey;
        field?: BookSortKey;
        key?: BookSortKey;
        dir?: BookSortDir;
        direction?: BookSortDir;
        order?: BookSortDir;
      },
  direction?: BookSortDir,
): { key: BookSortKey; dir: BookSortDir } {
  let key: BookSortKey = "title";
  let dir: BookSortDir = "asc";
  if (typeof sortBy === "string") {
    key = sortBy === "author" ? "author" : "title";
    if (direction === "desc") dir = "desc";
  } else if (sortBy && typeof sortBy === "object") {
    const o = sortBy as Record<string, unknown>;
    const k = o.sortBy ?? o.sort ?? o.field ?? o.key;
    if (k === "author") key = "author";
    const d = o.dir ?? o.direction ?? o.order;
    if (d === "desc") dir = "desc";
  }
  if (direction === "desc" && typeof sortBy === "string") dir = "desc";
  if (direction === "asc" && typeof sortBy === "string") dir = "asc";
  return { key, dir };
}

/** Sort a list of books by title or author, ascending or descending. */
export function sortBooks(
  books: Book[],
  sortBy?:
    | BookSortKey
    | {
        sortBy?: BookSortKey;
        sort?: BookSortKey;
        field?: BookSortKey;
        key?: BookSortKey;
        dir?: BookSortDir;
        direction?: BookSortDir;
        order?: BookSortDir;
      },
  direction?: BookSortDir,
): Book[] {
  const { key, dir } = normalizeSortArgs(sortBy, direction);
  const value = (book: Book): string =>
    key === "author" ? (book.author ?? "") : book.title;
  return [...books].sort((a, b) => {
    const result = value(a).localeCompare(value(b), undefined, { sensitivity: "base" });
    return dir === "desc" ? -result : result;
  });
}

/** Alias kept for callers that prefer a "by" suffix. */
export const sortBooksBy = sortBooks;
export const sortBooksByKey = sortBooks;

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

/** Overlay patch (note edit or reset) for the visible page (V2). */
export function applyNoteEdit(
  items: ClippingRow[],
  id: number,
  patch: { content_edited: string | null; edited_at: string | null },
): ClippingRow[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Tag chips shown before the +N toggle (S3). */
export const TAG_CHIP_LIMIT = 3;

/** Append a tag to one clipping's chips, ignoring a duplicate id or name. */
export function withTag(tags: Tag[], tag: Tag): Tag[] {
  if (tags.some((current) => current.id === tag.id)) {
    return tags;
  }
  const name = tag.name.toLowerCase();
  if (tags.some((current) => current.name.toLowerCase() === name)) {
    return tags;
  }
  return [...tags, tag];
}

/** Drop one tag chip by id; unknown ids leave the list untouched. */
export function withoutTag(tags: Tag[], tagId: number): Tag[] {
  return tags.filter((tag) => tag.id !== tagId);
}

/** Drop one tag id from the selected filter (a deleted or merged tag). */
export function withoutTagId(tagIds: number[], tagId: number): number[] {
  return tagIds.filter((id) => id !== tagId);
}

/** Chips to render and how many stay behind the +N toggle. */
export function tagOverflow(
  tags: Tag[],
  limit = TAG_CHIP_LIMIT,
): { visible: Tag[]; hidden: number } {
  return { visible: tags.slice(0, limit), hidden: Math.max(0, tags.length - limit) };
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
