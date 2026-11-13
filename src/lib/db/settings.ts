import { PAGE_SIZES } from "../library";
import {
  CLIPPING_SORT_DIRS,
  CLIPPING_SORT_KEYS,
  type ClippingSortDir,
  type ClippingSortKey,
} from "../sorting";
import type { ClippingKind } from "../types";
import type { DbPort } from "./port";

/** Setting keys for user preferences (locale, theme, filters). */
export const SETTINGS_KEYS = {
  locale: "locale",
  theme: "theme",
  darkPalette: "darkPalette",
  fontScale: "fontScale",
  filter: "filter",
  searchFolding: "searchFolding",
  autoBackup: "autoBackup",
} as const;

export async function getSetting(port: DbPort, key: string): Promise<string | null> {
  const rows = await port.select<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(port: DbPort, key: string, value: string): Promise<void> {
  await port.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Persisted filter + pagination state (page itself always restarts at 1). */
export interface StoredFilterState {
  query: string;
  bookId: number | null;
  kinds: ClippingKind[];
  favoritesOnly: boolean;
  /** Absent in payloads stored before the edited-notes filter existed. */
  editedOnly: boolean;
  /** Absent in payloads stored before tags existed. */
  tagIds?: number[];
  /** Absent in payloads stored before the author filter existed. */
  authors?: string[];
  pageSize: number;
  /** Absent in payloads stored before book sorting existed. */
  bookSortBy?: "title" | "author";
  /** Absent in payloads stored before book sorting existed. */
  bookSortDir?: "asc" | "desc";
  /** Absent in payloads stored before clipping sorting existed. */
  sortBy?: ClippingSortKey;
  /** Absent in payloads stored before clipping sorting existed. */
  sortDir?: ClippingSortDir;
}

const CLIPPING_KINDS: ClippingKind[] = ["highlight", "note", "bookmark"];
export async function saveFilterState(port: DbPort, state: StoredFilterState): Promise<void> {
  await setSetting(port, SETTINGS_KEYS.filter, JSON.stringify(state));
}

export async function loadFilterState(port: DbPort): Promise<StoredFilterState | null> {
  const raw = await getSetting(port, SETTINGS_KEYS.filter);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFilterState> & {
      /** Legacy single-kind shape (pre multi-select): migrated below. */
      kind?: ClippingKind | null;
    };
    const kinds =
      parsed.kinds ??
      (parsed.kind === undefined || parsed.kind === null ? [] : [parsed.kind]);
    // Widened for runtime validation: JSON may carry any string.
    const sortBy = parsed.sortBy as string | undefined;
    const sortDir = parsed.sortDir as string | undefined;
    if (
      typeof parsed.query !== "string" ||
      (parsed.bookId !== null && typeof parsed.bookId !== "number") ||
      !Array.isArray(kinds) ||
      !kinds.every((kind) => CLIPPING_KINDS.includes(kind)) ||
      typeof parsed.favoritesOnly !== "boolean" ||
      (parsed.editedOnly !== undefined && typeof parsed.editedOnly !== "boolean") ||
      (parsed.tagIds !== undefined &&
        (!Array.isArray(parsed.tagIds) ||
          !parsed.tagIds.every((id) => typeof id === "number" && Number.isInteger(id)))) ||
      (parsed.authors !== undefined &&
        (!Array.isArray(parsed.authors) ||
          !parsed.authors.every((author) => typeof author === "string"))) ||
      (parsed.bookSortBy !== undefined &&
        parsed.bookSortBy !== "title" &&
        parsed.bookSortBy !== "author") ||
      (parsed.bookSortDir !== undefined &&
        parsed.bookSortDir !== "asc" &&
        parsed.bookSortDir !== "desc") ||
      (sortBy !== undefined && !CLIPPING_SORT_KEYS.includes(sortBy as ClippingSortKey)) ||
      (sortDir !== undefined && !CLIPPING_SORT_DIRS.includes(sortDir as ClippingSortDir)) ||
      !PAGE_SIZES.includes(parsed.pageSize as number)
    ) {
      return null;
    }
    return {
      query: parsed.query,
      bookId: parsed.bookId ?? null,
      authors: [...new Set(parsed.authors ?? [])],
      kinds,
      favoritesOnly: parsed.favoritesOnly,
      editedOnly: parsed.editedOnly ?? false,
      tagIds: parsed.tagIds ?? [],
      pageSize: parsed.pageSize as number,
      ...(parsed.bookSortBy ? { bookSortBy: parsed.bookSortBy } : {}),
      ...(parsed.bookSortDir ? { bookSortDir: parsed.bookSortDir } : {}),
      ...(sortBy ? { sortBy: sortBy as ClippingSortKey } : {}),
      ...(sortDir ? { sortDir: sortDir as ClippingSortDir } : {}),
    };
  } catch {
    return null;
  }
}
