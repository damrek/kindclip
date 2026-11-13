/** One shape for everything the list, the sidebar and the saved filter agree
 * on. Adding a filter means touching this interface, its two mappers and the
 * snapshot in App — the compiler flags any mapper that forgets it. */
import type { StoredFilterState } from "./db";
import {
  DEFAULT_CLIPPING_SORT,
  type BookSortDir,
  type BookSortKey,
  type ClippingSort,
  type ClippingSortDir,
  type ClippingSortKey,
} from "./sorting";
import type { ClippingFilter, ClippingKind } from "./types";

export const DEFAULT_PAGE_SIZE = 20;

export interface FilterValues {
  /** Text in the search field (updated per keystroke). */
  query: string;
  /** Text the list filters by (debounced copy of `query`). */
  debouncedQuery: string;
  bookId: number | null;
  kinds: ClippingKind[];
  favoritesOnly: boolean;
  editedOnly: boolean;
  authors: string[];
  tagIds: number[];
  pageSize: number;
  bookSortBy: BookSortKey;
  bookSortDir: BookSortDir;
  sortBy: ClippingSortKey;
  sortDir: ClippingSortDir;
}

export function emptyFilters(): FilterValues {
  return {
    query: "",
    debouncedQuery: "",
    bookId: null,
    kinds: [],
    favoritesOnly: false,
    editedOnly: false,
    authors: [],
    tagIds: [],
    pageSize: DEFAULT_PAGE_SIZE,
    bookSortBy: "title",
    bookSortDir: "asc",
    sortBy: DEFAULT_CLIPPING_SORT.key,
    sortDir: DEFAULT_CLIPPING_SORT.dir,
  };
}

/** The query the data layer runs with; arrays are copied so the caller cannot
 * mutate the live filter by holding a reference. */
export function toFilter(values: FilterValues): ClippingFilter {
  return {
    query: values.debouncedQuery,
    bookId: values.bookId,
    authors: [...values.authors],
    kinds: [...values.kinds],
    favoritesOnly: values.favoritesOnly,
    editedOnly: values.editedOnly,
    tagIds: [...values.tagIds],
  };
}

export function clippingSort(values: FilterValues): ClippingSort {
  return { key: values.sortBy, dir: values.sortDir };
}

/** Payload persisted in settings; the page itself always restarts at 1. */
export function toStored(values: FilterValues): StoredFilterState {
  return {
    query: values.debouncedQuery,
    bookId: values.bookId,
    authors: [...values.authors],
    kinds: [...values.kinds],
    favoritesOnly: values.favoritesOnly,
    editedOnly: values.editedOnly,
    tagIds: [...values.tagIds],
    pageSize: values.pageSize,
    bookSortBy: values.bookSortBy,
    bookSortDir: values.bookSortDir,
    sortBy: values.sortBy,
    sortDir: values.sortDir,
  };
}

/** Values rebuilt from a stored payload. Fields added after a payload was
 * written fall back to their defaults, and ids whose tag or book is gone are
 * dropped by the caller (see `keepKnownTags`). */
export function fromStored(stored: StoredFilterState): FilterValues {
  return {
    ...emptyFilters(),
    query: stored.query ?? "",
    debouncedQuery: stored.query ?? "",
    bookId: stored.bookId ?? null,
    authors: stored.authors ?? [],
    kinds: stored.kinds ?? [],
    favoritesOnly: stored.favoritesOnly ?? false,
    editedOnly: stored.editedOnly ?? false,
    tagIds: stored.tagIds ?? [],
    pageSize: stored.pageSize ?? DEFAULT_PAGE_SIZE,
    bookSortBy: stored.bookSortBy ?? "title",
    bookSortDir: stored.bookSortDir ?? "asc",
    sortBy: stored.sortBy ?? DEFAULT_CLIPPING_SORT.key,
    sortDir: stored.sortDir ?? DEFAULT_CLIPPING_SORT.dir,
  };
}

/** Drop selected tag ids whose tag no longer exists. */
export function keepKnownTags(tagIds: number[], knownTagIds: number[]): number[] {
  const known = new Set(knownTagIds);
  return tagIds.filter((id) => known.has(id));
}

/** Add or remove one value from a multi-select filter. */
export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
