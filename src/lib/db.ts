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

/** Order of the clipping list: date, book title or reading position. */
export type ClippingSortKey = "date" | "title" | "page";
export type ClippingSortDir = "asc" | "desc";

export interface ClippingSort {
  key: ClippingSortKey;
  dir: ClippingSortDir;
}

/** Newest first: the historical order, kept as the default. */
export const DEFAULT_CLIPPING_SORT: ClippingSort = { key: "date", dir: "desc" };

/** ORDER BY clause per sort key; `page` keeps unnumbered rows last both ways. */
function buildOrderClause(sort: ClippingSort): string {
  const dir = sort.dir === "asc" ? "ASC" : "DESC";
  if (sort.key === "title") {
    return `ORDER BY b.title COLLATE NOCASE ${dir}, COALESCE(c.added_on, '') ${dir}, c.id ${dir}`;
  }
  if (sort.key === "page") {
    return (
      "ORDER BY CASE WHEN c.page IS NULL THEN 1 ELSE 0 END ASC, " +
      `c.page ${dir}, COALESCE(c.added_on, '') ${dir}, c.id ${dir}`
    );
  }
  return `ORDER BY COALESCE(c.added_on, '') ${dir}, c.id ${dir}`;
}

const LIST_FROM =
  "FROM clippings c " +
  "JOIN books b ON b.id = c.book_id " +
  "LEFT JOIN favorites f ON f.clipping_id = c.id";

/** Columns returned by the list and the export query (same shape, S2). */
const LIST_SELECT =
  "SELECT c.id, b.title, b.author, c.kind, c.page, c.location, " +
  "c.added_on_raw, c.added_on, c.content, c.content_hash, " +
  "c.content_edited, c.edited_at, " +
  "CASE WHEN f.clipping_id IS NULL THEN 0 ELSE 1 END AS favorite ";

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
  if (filter.editedOnly) {
    conditions.push("c.content_edited IS NOT NULL");
  }
  return { sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function buildListQuery(
  filter: ClippingFilter,
  page: PageRequest,
  sort: ClippingSort = DEFAULT_CLIPPING_SORT,
): { sql: string; params: unknown[] } {
  const { sql: where, params } = buildWhere(filter);
  const limit = `$${params.length + 1}`;
  const offset = `$${params.length + 2}`;
  params.push(page.pageSize, (page.page - 1) * page.pageSize);
  const sql =
    `${LIST_SELECT}${LIST_FROM} ${where} ` +
    `${buildOrderClause(sort)} LIMIT ${limit} OFFSET ${offset}`;
  return { sql, params };
}

export function buildCountQuery(filter: ClippingFilter): { sql: string; params: unknown[] } {
  const { sql: where, params } = buildWhere(filter);
  return { sql: `SELECT COUNT(*) AS total ${LIST_FROM} ${where}`, params };
}

/** Row shape as returned by SQLite (favorite is 0/1), mapped to boolean below. */
type ClippingRowRaw = Omit<ClippingRow, "favorite"> & { favorite: number };

function mapClippingRow(row: ClippingRowRaw): ClippingRow {
  return { ...row, favorite: row.favorite === 1 };
}

export async function listClippings(
  filter: ClippingFilter,
  page: PageRequest,
  sort: ClippingSort = DEFAULT_CLIPPING_SORT,
): Promise<PagedResult<ClippingRow>> {
  const port = await getDb();
  const list = buildListQuery(filter, page, sort);
  const count = buildCountQuery(filter);
  const rows = await port.select<ClippingRowRaw>(list.sql, list.params);
  const totals = await port.select<{ total: number }>(count.sql, count.params);
  return {
    items: rows.map(mapClippingRow),
    total: totals[0]?.total ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/** Every row matching the filter (the whole filtered view, S2), unpaginated
 * for export: same SELECT as the list, ordered by book and then chronology. */
export async function exportClippings(filter: ClippingFilter): Promise<ClippingRow[]> {
  const port = await getDb();
  const { sql: where, params } = buildWhere(filter);
  const sql =
    `${LIST_SELECT}${LIST_FROM}${where === "" ? "" : ` ${where}`} ` +
    "ORDER BY b.title COLLATE NOCASE, COALESCE(c.added_on, '') ASC, c.id ASC";
  const rows = await port.select<ClippingRowRaw>(sql, params);
  return rows.map(mapClippingRow);
}

export type BookSortKey = "title" | "author";
export type BookSortDir = "asc" | "desc";

function normalizeBookSort(
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
    dir = direction === "desc" ? "desc" : "asc";
  } else if (sortBy && typeof sortBy === "object") {
    const o = sortBy as Record<string, unknown>;
    const k = o.sortBy ?? o.sort ?? o.field ?? o.key;
    if (k === "author") key = "author";
    const d = o.dir ?? o.direction ?? o.order;
    if (d === "desc") dir = "desc";
    if (d === "asc") dir = "asc";
  }
  if (typeof sortBy === "string" && direction) {
    dir = direction === "desc" ? "desc" : "asc";
  }
  return { key, dir };
}

export function buildBooksQuery(
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
): { sql: string; params: unknown[] } {
  const { key, dir } = normalizeBookSort(sortBy, direction);
  const column = key === "author" ? "COALESCE(b.author, '')" : "b.title";
  const sql =
    "SELECT b.id, b.title, b.author, COUNT(c.id) AS clipping_count " +
    "FROM books b JOIN clippings c ON c.book_id = b.id " +
    "GROUP BY b.id, b.title, b.author " +
    `ORDER BY ${column} COLLATE NOCASE ${dir.toUpperCase()}`;
  return { sql, params: [] };
}

export const LIST_BOOKS_SQL =
  "SELECT b.id, b.title, b.author, COUNT(c.id) AS clipping_count " +
  "FROM books b JOIN clippings c ON c.book_id = b.id " +
  "GROUP BY b.id, b.title, b.author ORDER BY b.title COLLATE NOCASE";

export async function listBooks(
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
): Promise<Book[]> {
  const port = await getDb();
  const { sql } = buildBooksQuery(sortBy, direction);
  return port.select<Book>(sql);
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

/** One row of the imported-files list (library management). */
export interface ImportedFile {
  id: number;
  path: string;
  imported_at: string;
  clipping_count: number;
}

export type RenameBookResult =
  | { status: "renamed" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "merge-required"; existingBookId: number };

export type MergeBooksResult =
  | { status: "merged"; moved: number }
  | { status: "missing" };

export interface RemoveFileResult {
  clippings: number;
  books: number;
}

/** Imported files, newest first, with the clippings still attached to each.
 * Live count: `files.clipping_count` is import-time metadata only. */
export async function listImportedFiles(port: DbPort): Promise<ImportedFile[]> {
  return port.select<ImportedFile>(
    "SELECT f.id, f.path, f.imported_at, " +
      "(SELECT COUNT(*) FROM clippings c WHERE c.file_id = f.id) AS clipping_count " +
      "FROM files f ORDER BY f.imported_at DESC, f.id DESC",
  );
}

/** Find the book that already owns a (title, author) pair, if any. */
async function findBookByPair(
  port: DbPort,
  title: string,
  author: string | null,
  excludeId: number,
): Promise<number | null> {
  const rows = await port.select<{ id: number }>(
    "SELECT id FROM books WHERE title = $1 AND COALESCE(author, '') = COALESCE($2, '') AND id <> $3",
    [title, author, excludeId],
  );
  return rows[0]?.id ?? null;
}

/** Update a book's title/author without moving its clippings. A duplicate
 * pair is reported as `merge-required`, never as a raw UNIQUE failure. */
export async function renameBook(
  port: DbPort,
  bookId: number,
  title: string,
  author: string | null,
): Promise<RenameBookResult> {
  const cleanTitle = title.trim();
  if (cleanTitle === "") {
    return { status: "invalid" };
  }
  const cleanAuthor = author?.trim() ? author.trim() : null;

  const existing = await findBookByPair(port, cleanTitle, cleanAuthor, bookId);
  if (existing !== null) {
    return { status: "merge-required", existingBookId: existing };
  }

  try {
    const result = await port.execute("UPDATE books SET title = $1, author = $2 WHERE id = $3", [
      cleanTitle,
      cleanAuthor,
      bookId,
    ]);
    return (result.rowsAffected ?? 0) > 0 ? { status: "renamed" } : { status: "missing" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("UNIQUE constraint failed")) {
      throw error;
    }
    const raced = await findBookByPair(port, cleanTitle, cleanAuthor, bookId);
    if (raced === null) {
      throw error;
    }
    return { status: "merge-required", existingBookId: raced };
  }
}

/** Move every clipping to the target book, then delete the source row.
 * Clipping ids (and their favorites) survive the move. */
export async function mergeBooks(
  port: DbPort,
  sourceId: number,
  targetId: number,
): Promise<MergeBooksResult> {
  if (sourceId === targetId) {
    return { status: "merged", moved: 0 };
  }
  const target = await port.select<{ id: number }>("SELECT id FROM books WHERE id = $1", [
    targetId,
  ]);
  if (target.length === 0) {
    return { status: "missing" };
  }
  const moved = await port.execute("UPDATE clippings SET book_id = $1 WHERE book_id = $2", [
    targetId,
    sourceId,
  ]);
  await port.execute("DELETE FROM books WHERE id = $1", [sourceId]);
  return { status: "merged", moved: moved.rowsAffected ?? 0 };
}

/** Delete a book with its clippings and favorites, children first. Returns the
 * number of clippings removed. */
export async function deleteBook(port: DbPort, bookId: number): Promise<number> {
  const rows = await port.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM clippings WHERE book_id = $1",
    [bookId],
  );
  const clippings = Number(rows[0]?.n ?? 0);

  await port.execute(
    "DELETE FROM favorites WHERE clipping_id IN (SELECT id FROM clippings WHERE book_id = $1)",
    [bookId],
  );
  await port.execute("DELETE FROM clippings WHERE book_id = $1", [bookId]);
  await port.execute("DELETE FROM books WHERE id = $1", [bookId]);
  return clippings;
}

/** Undo one import: delete its clippings and favorites, drop books left empty,
 * then delete the file row. Re-importing the file restores the clippings. */
export async function removeImportedFile(
  port: DbPort,
  fileId: number,
): Promise<RemoveFileResult> {
  const rows = await port.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM clippings WHERE file_id = $1",
    [fileId],
  );
  const clippings = Number(rows[0]?.n ?? 0);

  await port.execute(
    "DELETE FROM favorites WHERE clipping_id IN (SELECT id FROM clippings WHERE file_id = $1)",
    [fileId],
  );
  await port.execute("DELETE FROM clippings WHERE file_id = $1", [fileId]);
  const books = await port.execute(
    "DELETE FROM books WHERE NOT EXISTS (SELECT 1 FROM clippings c WHERE c.book_id = books.id)",
  );
  await port.execute("DELETE FROM files WHERE id = $1", [fileId]);
  return { clippings, books: books.rowsAffected ?? 0 };
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
  /** Absent in payloads stored before the edited-notes filter existed. */
  editedOnly: boolean;
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
const CLIPPING_SORT_KEYS: ClippingSortKey[] = ["date", "title", "page"];
const CLIPPING_SORT_DIRS: ClippingSortDir[] = ["asc", "desc"];

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
      kinds,
      favoritesOnly: parsed.favoritesOnly,
      editedOnly: parsed.editedOnly ?? false,
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
