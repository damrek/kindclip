/** Shared contracts between the Rust backend and the Svelte frontend. */

export type ClippingKind = "highlight" | "note" | "bookmark";

/** One parsed entry, as returned by the `parse_clippings_file` command. */
export interface ClippingDto {
  title: string;
  author: string | null;
  kind: ClippingKind;
  page: number | null;
  location: string | null;
  added_on_raw: string;
  added_on: string | null;
  content: string | null;
  content_hash: string;
}

export interface Book {
  id: number;
  title: string;
  author: string | null;
  clipping_count: number;
}

/** A user-defined label attached to one clipping (tags feature, S1). */
export interface Tag {
  id: number;
  name: string;
}

/** A clipping row as displayed in the list (includes favorite state). */
export interface ClippingRow extends ClippingDto {
  id: number;
  favorite: boolean;
  /** Overlay for note editing (V2): edited text; null = original shown. */
  content_edited: string | null;
  edited_at: string | null;
  /** Labels attached to this clipping, in link order. */
  tags: Tag[];
}

export interface ClippingFilter {
  /** Free text matched against content, title and author. */
  query: string;
  bookId: number | null;
  /** Selected kinds; empty means all. */
  kinds: ClippingKind[];
  favoritesOnly: boolean;
  /** Restricts the list to notes whose text was edited over the original. */
  editedOnly: boolean;
  /** Selected tags; the list keeps clippings carrying all of them (AND). */
  tagIds: number[];
}

export interface PageRequest {
  page: number; // 1-based
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportReport {
  fileId: number;
  total: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  bookCount: number;
  alreadyImported: boolean;
}
