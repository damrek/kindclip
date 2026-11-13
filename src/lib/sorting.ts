/** Sort vocabulary shared by the clipping list and the book sidebar.
 *
 * One module owns the keys, the directions and the book comparator, so the
 * persisted filter, the SQL ORDER BY and the sidebar cannot drift apart. */
import type { Book } from "./types";

export type SortDir = "asc" | "desc";

export type ClippingSortKey = "date" | "title" | "page";
export type ClippingSortDir = SortDir;

export interface ClippingSort {
  key: ClippingSortKey;
  dir: ClippingSortDir;
}

/** Newest first: the historical order, kept as the default. */
export const DEFAULT_CLIPPING_SORT: ClippingSort = { key: "date", dir: "desc" };

/** Runtime validation lists for the persisted filter payload. */
export const CLIPPING_SORT_KEYS: ClippingSortKey[] = ["date", "title", "page"];
export const CLIPPING_SORT_DIRS: ClippingSortDir[] = ["asc", "desc"];

export type BookSortKey = "title" | "author";
export type BookSortDir = SortDir;

export const BOOK_SORT_KEYS: BookSortKey[] = ["title", "author"];

/** Sort a copy of the books by title or author. Case-insensitive so "the" and
 * "The" land together; the input array is never mutated. */
export function sortBooks(books: Book[], key: BookSortKey, dir: BookSortDir): Book[] {
  const value = (book: Book): string => (key === "author" ? (book.author ?? "") : book.title);
  return [...books].sort((a, b) => {
    const result = value(a).localeCompare(value(b), undefined, { sensitivity: "base" });
    return dir === "desc" ? -result : result;
  });
}
