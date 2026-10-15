import Database from "@tauri-apps/plugin-sql";
import type {
  Book,
  ClippingDto,
  ClippingFilter,
  ClippingKind,
  ClippingRow,
  ImportReport,
  PagedResult,
  PageRequest,
} from "./types";
import { PAGE_SIZES } from "./library";

/** Minimal SQL surface the store needs; real (plugin) or fake (tests). */
export interface DbPort {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId?: number; rowsAffected?: number }>;
}

const DB_URL = "sqlite:kindclip.db";

let dbPromise: Promise<DbPort> | null = null;

/** Shared plugin-sql connection (preloaded + migrated at startup). */
export function getDb(): Promise<DbPort> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then((db) => ({
      select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
      execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
    }));
  }
  return dbPromise;
}

/** Escape user text for use inside a LIKE pattern (with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const LIST_FROM =
  "FROM clippings c " +
  "JOIN books b ON b.id = c.book_id " +
  "LEFT JOIN favorites f ON f.clipping_id = c.id";

function buildWhere(filter: ClippingFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const query = filter.query.trim();
  if (query !== "") {
    const like = `%${escapeLike(query)}%`;
    const p1 = next(like);
    const p2 = next(like);
    const p3 = next(like);
    conditions.push(
      `(COALESCE(c.content_edited, c.content) LIKE ${p1} ESCAPE '\\' ` +
        `OR b.title LIKE ${p2} ESCAPE '\\' OR b.author LIKE ${p3} ESCAPE '\\')`,
    );
  }
  if (filter.bookId !== null) {
    conditions.push(`b.id = ${next(filter.bookId)}`);
  }
  if (filter.kinds.length > 0) {
    const placeholders = filter.kinds.map((kind) => next(kind));
    conditions.push(`c.kind IN (${placeholders.join(", ")})`);
  }
  if (filter.favoritesOnly) {
    conditions.push("f.clipping_id IS NOT NULL");
  }
  return { sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function buildListQuery(
  filter: ClippingFilter,
  page: PageRequest,
): { sql: string; params: unknown[] } {
  const { sql: where, params } = buildWhere(filter);
  const limit = `$${params.length + 1}`;
  const offset = `$${params.length + 2}`;
  params.push(page.pageSize, (page.page - 1) * page.pageSize);
  const sql =
    "SELECT c.id, b.title, b.author, c.kind, c.page, c.location, " +
    "c.added_on_raw, c.added_on, c.content, c.content_hash, " +
    "c.content_edited, c.edited_at, " +
    "CASE WHEN f.clipping_id IS NULL THEN 0 ELSE 1 END AS favorite " +
    `${LIST_FROM} ${where} ` +
    `ORDER BY COALESCE(c.added_on, '') DESC, c.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return { sql, params };
}

export function buildCountQuery(filter: ClippingFilter): { sql: string; params: unknown[] } {
  const { sql: where, params } = buildWhere(filter);
  return { sql: `SELECT COUNT(*) AS total ${LIST_FROM} ${where}`, params };
}

/** Row shape as returned by SQLite (favorite is 0/1), mapped to boolean below. */
type ClippingRowRaw = Omit<ClippingRow, "favorite"> & { favorite: number };

export async function listClippings(
  filter: ClippingFilter,
  page: PageRequest,
): Promise<PagedResult<ClippingRow>> {
  const port = await getDb();
  const list = buildListQuery(filter, page);
  const count = buildCountQuery(filter);
  const rows = await port.select<ClippingRowRaw>(list.sql, list.params);
  const totals = await port.select<{ total: number }>(count.sql, count.params);
  return {
    items: rows.map((row) => ({ ...row, favorite: row.favorite === 1 })),
    total: totals[0]?.total ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

export const LIST_BOOKS_SQL =
  "SELECT b.id, b.title, b.author, COUNT(c.id) AS clipping_count " +
  "FROM books b JOIN clippings c ON c.book_id = b.id " +
  "GROUP BY b.id, b.title, b.author ORDER BY b.title COLLATE NOCASE";

export async function listBooks(): Promise<Book[]> {
  const port = await getDb();
  return port.select<Book>(LIST_BOOKS_SQL);
}

export async function toggleFavorite(port: DbPort, clippingId: number): Promise<boolean> {  const rows = await port.select<{ clipping_id: number }>(
    "SELECT clipping_id FROM favorites WHERE clipping_id = $1",
    [clippingId],
  );
  if (rows.length > 0) {
    await port.execute("DELETE FROM favorites WHERE clipping_id = $1", [clippingId]);
    return false;
  }
  await port.execute("INSERT INTO favorites (clipping_id, created_at) VALUES ($1, $2)", [
    clippingId,
    new Date().toISOString(),
  ]);
  return true;
}

/** Overlay edit for a note (V2): the original content and its dedupe
 * hash stay untouched, so re-imports remain idempotent. */
export async function updateNote(port: DbPort, clippingId: number, content: string): Promise<boolean> {
  const result = await port.execute(
    "UPDATE clippings SET content_edited = $1, edited_at = $2 WHERE id = $3 AND kind = 'note'",
    [content, new Date().toISOString(), clippingId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/** Discard the overlay edit and show the original Kindle text again. */
export async function resetNote(port: DbPort, clippingId: number): Promise<boolean> {
  const result = await port.execute(
    "UPDATE clippings SET content_edited = NULL, edited_at = NULL WHERE id = $1 AND kind = 'note'",
    [clippingId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

export interface ImportInput {
  path: string;
  fileHash: string;
  clippings: ClippingDto[];
}

export async function importParsedClippings(
  port: DbPort,
  input: ImportInput,
  onProgress: (done: number, total: number) => void,
): Promise<ImportReport> {
  const total = input.clippings.length;

  const knownFileRows = await port.select<{ id: number; file_hash: string }>(
    "SELECT id, file_hash FROM files WHERE file_hash = $1",
    [input.fileHash],
  );
  const knownFile = knownFileRows[0] ?? null;

  const knownHashes = new Set(
    (await port.select<{ content_hash: string }>("SELECT content_hash FROM clippings")).map(
      (row) => row.content_hash,
    ),
  );
  const seen = new Set<string>();
  const fresh = input.clippings.filter((clip) => {
    if (knownHashes.has(clip.content_hash) || seen.has(clip.content_hash)) {
      return false;
    }
    seen.add(clip.content_hash);
    return true;
  });

  const now = new Date().toISOString();
  let fileId: number;
  if (knownFile) {
    // Re-import (e.g. after a parser fix): pick up entries that were
    // previously unparseable instead of silently skipping the file.
    fileId = knownFile.id;
    if (fresh.length > 0) {
      await port.execute(
        "UPDATE files SET path = $1, clipping_count = clipping_count + $2, imported_at = $3 WHERE id = $4",
        [input.path, fresh.length, now, fileId],
      );
    }
  } else {
    const fileResult = await port.execute(
      "INSERT INTO files (path, file_hash, clipping_count, imported_at) VALUES ($1, $2, $3, $4)",
      [input.path, input.fileHash, fresh.length, now],
    );
    fileId = fileResult.lastInsertId ?? -1;
  }

  const bookIds = new Map<string, number>();
  let inserted = 0;
  for (let index = 0; index < total; index += 1) {
    const clip = input.clippings[index];
    if (fresh.includes(clip)) {
      const key = JSON.stringify([clip.title, clip.author ?? ""]);
      let bookId = bookIds.get(key);
      if (bookId === undefined) {
        const rows = await port.select<{ id: number }>(
          "SELECT id FROM books WHERE title = $1 AND COALESCE(author, '') = COALESCE($2, '')",
          [clip.title, clip.author],
        );
        if (rows.length > 0) {
          bookId = rows[0].id;
        } else {
          const created = await port.execute("INSERT INTO books (title, author) VALUES ($1, $2)", [
            clip.title,
            clip.author,
          ]);
          bookId = created.lastInsertId ?? -1;
        }
        bookIds.set(key, bookId);
      }
      await port.execute(
        "INSERT INTO clippings (book_id, file_id, kind, page, location, added_on_raw, added_on, content, content_hash, created_at) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [
          bookId,
          fileId,
          clip.kind,
          clip.page,
          clip.location,
          clip.added_on_raw,
          clip.added_on,
          clip.content,
          clip.content_hash,
          now,
        ],
      );
      inserted += 1;
    }
    onProgress(index + 1, total);
  }

  return {
    fileId,
    total,
    inserted,
    duplicates: total - inserted,
    bookCount: bookIds.size,
    alreadyImported: knownFile !== null && inserted === 0,
  };
}

/** Setting keys for user preferences (locale, theme, filters). */
export const SETTINGS_KEYS = {
  locale: "locale",
  theme: "theme",
  fontScale: "fontScale",
  filter: "filter",
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
  pageSize: number;
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
    if (
      typeof parsed.query !== "string" ||
      (parsed.bookId !== null && typeof parsed.bookId !== "number") ||
      !Array.isArray(kinds) ||
      !kinds.every((kind) => CLIPPING_KINDS.includes(kind)) ||
      typeof parsed.favoritesOnly !== "boolean" ||
      !PAGE_SIZES.includes(parsed.pageSize as number)
    ) {
      return null;
    }
    return {
      query: parsed.query,
      bookId: parsed.bookId ?? null,
      kinds,
      favoritesOnly: parsed.favoritesOnly,
      pageSize: parsed.pageSize as number,
    };
  } catch {
    return null;
  }
}
