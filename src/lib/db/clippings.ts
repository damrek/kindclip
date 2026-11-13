import { emptyFilter, foldText } from "../library";
import { searchTerms } from "../search";
import { DEFAULT_CLIPPING_SORT, type ClippingSort } from "../sorting";
import type {
  ClippingFilter,
  ClippingRow,
  PagedResult,
  PageRequest,
  Tag,
} from "../types";
import type { DbPort } from "./port";

/** Escape user text for use inside a LIKE pattern (with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

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

  // Every query word must match somewhere (content, title or author), in any
  // order; a query is a set of terms, not one phrase.
  for (const term of searchTerms(filter.query)) {
    const like = `%${escapeLike(term)}%`;
    const p1 = next(like);
    const p2 = next(like);
    const p3 = next(like);
    conditions.push(
      `(COALESCE(c.content_edited_folded, c.content_folded) LIKE ${p1} ESCAPE '\\' ` +
        `OR b.title_folded LIKE ${p2} ESCAPE '\\' OR b.author_folded LIKE ${p3} ESCAPE '\\')`,
    );
  }
  if (filter.bookId !== null) {
    conditions.push(`b.id = ${next(filter.bookId)}`);
  }
  // Author filter (S4): the folded key also covers the unknown author ("").
  // Duplicates are dropped so the clause always holds distinct keys.
  const authorKeys = [...new Set(filter.authors)];
  if (authorKeys.length > 0) {
    const placeholders = authorKeys.map((key) => next(key));
    conditions.push(`COALESCE(b.author_folded, '') IN (${placeholders.join(", ")})`);
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
  // Tag intersection (S2): the clipping must carry every selected tag.
  // Duplicates are dropped so `= N` always means N distinct tags.
  const tagIds = [...new Set(filter.tagIds ?? [])];
  if (tagIds.length > 0) {
    const placeholders = tagIds.map((tagId) => next(tagId));
    conditions.push(
      `(SELECT COUNT(DISTINCT ct.tag_id) FROM clipping_tags ct ` +
        `WHERE ct.clipping_id = c.id AND ct.tag_id IN (${placeholders.join(", ")})) = ${tagIds.length}`,
    );
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

/** SQL for the global palette: every clipping, no list filters, newest first.
 * The query keeps the same folded, all-terms semantics as the list search. */
export function buildSearchQuery(
  query: string,
  limit = 50,
): { sql: string; params: unknown[] } {
  const { sql: where, params } = buildWhere({ ...emptyFilter(), query });
  const limitParam = `$${params.length + 1}`;
  params.push(limit);
  const sql =
    `${LIST_SELECT}${LIST_FROM}${where === "" ? "" : ` ${where}`} ` +
    `ORDER BY COALESCE(c.added_on, '') DESC, c.id DESC LIMIT ${limitParam}`;
  return { sql, params };
}

/** Row shape as returned by SQLite (favorite is 0/1, tags are hydrated apart). */
type ClippingRowRaw = Omit<ClippingRow, "favorite" | "tags"> & { favorite: number };

function mapClippingRow(row: ClippingRowRaw): ClippingRow {
  return { ...row, favorite: row.favorite === 1, tags: [] };
}

/** Attach the tags of one page/export to its rows with a single extra query. */
async function withTags(
  port: DbPort,
  rows: ClippingRow[],
): Promise<ClippingRow[]> {
  const grouped = await loadClippingTags(
    port,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, tags: grouped.get(row.id) ?? [] }));
}

export async function listClippings(
  port: DbPort,
  filter: ClippingFilter,
  page: PageRequest,
  sort: ClippingSort = DEFAULT_CLIPPING_SORT,
): Promise<PagedResult<ClippingRow>> {
  const list = buildListQuery(filter, page, sort);
  const count = buildCountQuery(filter);
  const rows = await port.select<ClippingRowRaw>(list.sql, list.params);
  const totals = await port.select<{ total: number }>(count.sql, count.params);
  const items = await withTags(port, rows.map(mapClippingRow));
  return {
    items,
    total: totals[0]?.total ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/** Global palette rows: every book, no list filters, newest first. Tags are
 * left empty because the palette does not render them. */
export async function searchClippings(
  port: DbPort,
  query: string,
  limit = 50,
): Promise<ClippingRow[]> {
  const { sql, params } = buildSearchQuery(query, limit);
  const rows = await port.select<ClippingRowRaw>(sql, params);
  return rows.map(mapClippingRow);
}

/** How many clippings the palette query matches in total, so the dialog can
 * say "20 of 1,284" instead of implying the shown rows are everything. */
export async function countClippings(port: DbPort, query: string): Promise<number> {
  const { sql, params } = buildCountQuery({ ...emptyFilter(), query });
  const rows = await port.select<{ total: number }>(sql, params);
  return rows[0]?.total ?? 0;
}

/** Every row matching the filter (the whole filtered view, S2), unpaginated
 * for export: same SELECT as the list, ordered by book and then chronology. */
export async function exportClippings(
  port: DbPort,
  filter: ClippingFilter,
): Promise<ClippingRow[]> {
  const { sql: where, params } = buildWhere(filter);
  const sql =
    `${LIST_SELECT}${LIST_FROM}${where === "" ? "" : ` ${where}`} ` +
    "ORDER BY b.title COLLATE NOCASE, COALESCE(c.added_on, '') ASC, c.id ASC";
  const rows = await port.select<ClippingRowRaw>(sql, params);
  return withTags(port, rows.map(mapClippingRow));
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
    "UPDATE clippings SET content_edited = $1, content_edited_folded = $2, edited_at = $3 " +
      "WHERE id = $4 AND kind = 'note'",
    [content, foldText(content), new Date().toISOString(), clippingId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/** Discard the overlay edit and show the original Kindle text again. */
export async function resetNote(port: DbPort, clippingId: number): Promise<boolean> {
  const result = await port.execute(
    "UPDATE clippings SET content_edited = NULL, content_edited_folded = NULL, edited_at = NULL " +
      "WHERE id = $1 AND kind = 'note'",
    [clippingId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/** Tags of several clippings in one query per batch, grouped and kept in link order. */
export async function loadClippingTags(
  port: DbPort,
  clippingIds: number[],
): Promise<Map<number, Tag[]>> {
  const unique = [...new Set(clippingIds)];
  const grouped = new Map<number, Tag[]>();
  if (unique.length === 0) {
    return grouped;
  }
  // Stay under SQLite's bound-variable limit on large exports.
  const BATCH = 500;
  for (let start = 0; start < unique.length; start += BATCH) {
    const batch = unique.slice(start, start + BATCH);
    const placeholders = batch.map((_, index) => `$${index + 1}`);
    const rows = await port.select<{ clipping_id: number; id: number; name: string }>(
      "SELECT ct.clipping_id, t.id, t.name FROM clipping_tags ct JOIN tags t ON t.id = ct.tag_id " +
        `WHERE ct.clipping_id IN (${placeholders.join(", ")}) ` +
        "ORDER BY ct.created_at, t.name COLLATE NOCASE",
      batch,
    );
    for (const row of rows) {
      const tag: Tag = { id: row.id, name: row.name };
      const list = grouped.get(row.clipping_id);
      if (list === undefined) {
        grouped.set(row.clipping_id, [tag]);
      } else {
        list.push(tag);
      }
    }
  }
  return grouped;
}
