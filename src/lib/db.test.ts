import { describe, expect, it, vi } from "vitest";
import {
  addClippingTag,
  backfillSearchFolding,
  buildCountQuery,
  buildListQuery,
  deleteBook,
  deleteTag,
  ensureTag,
  escapeLike,
  exportClippings,
  getSetting,
  importParsedClippings,
  listClippings,
  listImportedFiles,
  listTags,
  loadClippingTags,
  loadFilterState,
  mergeBooks,
  mergeTags,
  removeClippingTag,
  removeImportedFile,
  renameBook,
  renameTag,
  resetNote,
  saveFilterState,
  SETTINGS_KEYS,
  setSetting,
  toggleFavorite,
  updateNote,
  type DbPort,
  type StoredFilterState,
} from "./db";
import type { ClippingDto, ClippingFilter } from "./types";

/** Backing port for the mocked plugin-sql connection: `exportClippings` is
 * the only db.ts function that goes through `getDb()`, so tests assign a
 * FakePort here before calling it. */
const plugin = vi.hoisted(() => ({ port: null as DbPort | null }));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: (sql: string, params?: unknown[]) => plugin.port!.select(sql, params),
      execute: (sql: string, params?: unknown[]) => plugin.port!.execute(sql, params),
    }),
  },
}));

function clipping(overrides: Partial<ClippingDto> = {}): ClippingDto {
  return {
    title: "Some Book",
    author: "Some Author",
    kind: "highlight",
    page: 1,
    location: "1-2",
    added_on_raw: "raw",
    added_on: "2020-01-06T10:15:00",
    content: "Some content",
    content_hash: "hash-" + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

/** Minimal in-memory fake of the SQL port, scripted by SQL shape. */
class FakePort implements DbPort {
  existingHashes = new Set<string>();
  existingFiles = new Map<string, number>();
  books = new Map<string, number>();
  favorites = new Set<number>();
  settings = new Map<string, string>();
  insertedClippings: string[] = [];
  /** Full parameter list of every clipping insert, in insertion order. */
  clippingInserts: unknown[][] = [];
  /** Full parameter list of every book insert, in insertion order. */
  bookInserts: unknown[][] = [];
  fileUpdates: Array<{ id: number; added: number }> = [];
  noteEdits = new Map<number, { content: string; at: string }>();
  noteResets: number[] = [];
  executedSql: string[] = [];
  /** Rows served to the export query, in SQLite shape (favorite 0/1). */
  clippingRows: unknown[] = [];
  /** Total served to the count query of the paginated list. */
  total = 0;
  /** Rows served to the tag-hydration query. */
  tagRows: unknown[] = [];
  tagCalls: Array<{ sql: string; params: unknown[] }> = [];
  selectCalls: Array<{ sql: string; params: unknown[] }> = [];
  lastId = 100;
  fileId = 7;

  async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (sql.includes("COUNT(*) AS total")) {
      return [{ total: this.total }] as T[];
    }
    if (sql.includes("FROM clipping_tags ct")) {
      this.tagCalls.push({ sql, params: params ?? [] });
      return this.tagRows as T[];
    }
    if (sql.includes("FROM clippings c")) {
      this.selectCalls.push({ sql, params: params ?? [] });
      return this.clippingRows as T[];
    }
    if (sql.includes("content_hash")) {
      return [...this.existingHashes].map((h) => ({ content_hash: h }) as T);
    }
    if (sql.includes("FROM settings")) {
      const rows = [...this.settings].map(([key, value]) => ({ key, value }) as T);
      if (params && params.length > 0) {
        return rows.filter((row) => (row as { key: string }).key === params[0]);
      }
      return rows;
    }
    if (sql.includes("FROM files")) {
      return [...this.existingFiles].map(([hash, id]) => ({ id, file_hash: hash }) as T);
    }
    if (sql.includes("FROM books") && sql.includes("WHERE")) {
      return [] as T[];
    }
    if (sql.includes("FROM favorites")) {
      return [...this.favorites].map((id) => ({ clipping_id: id }) as T);
    }
    return [] as T[];
  }

  async execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId?: number; rowsAffected?: number }> {
    this.executedSql.push(sql);
    if (sql.includes("INSERT INTO clippings")) {
      const allParams = params ?? [];
      // Multi-row INSERT: params come as flat array [row1col1, row1col2, ..., row2col1, row2col2, ...]
      // Each row has 11 columns. Split into individual rows.
      const colsPerRow = 11;
      const rowCount = allParams.length / colsPerRow;
      for (let i = 0; i < rowCount; i++) {
        const rowParams = allParams.slice(i * colsPerRow, (i + 1) * colsPerRow);
        this.clippingInserts.push(rowParams);
        this.insertedClippings.push(rowParams[8] as string);
      }
      return { lastInsertId: ++this.lastId, rowsAffected: rowCount };
    }
    if (sql.includes("INSERT INTO books")) {
      this.bookInserts.push(params ?? []);
      const key = `${params?.[0]}|${params?.[1] ?? ""}`;
      const id = ++this.lastId;
      this.books.set(key, id);
      return { lastInsertId: id, rowsAffected: 1 };
    }
    if (sql.includes("INTO settings")) {
      this.settings.set(params?.[0] as string, params?.[1] as string);
      return { rowsAffected: 1 };
    }
    if (sql.includes("UPDATE clippings")) {
      if (sql.includes("content_edited = NULL")) {
        this.noteResets.push(params?.[0] as number);
      } else {
        this.noteEdits.set(params?.[3] as number, {
          content: params?.[0] as string,
          at: params?.[2] as string,
        });
      }
      return { rowsAffected: 1 };
    }
    if (sql.includes("INSERT INTO files")) {
      return { lastInsertId: this.fileId, rowsAffected: 1 };
    }
    if (sql.includes("UPDATE files")) {
      this.fileUpdates.push({ id: params?.[3] as number, added: params?.[1] as number });
      return { rowsAffected: 1 };
    }
    if (sql.includes("INSERT INTO favorites")) {
      this.favorites.add(params?.[0] as number);
      return { rowsAffected: 1 };
    }
    if (sql.includes("DELETE FROM favorites")) {
      this.favorites.delete(params?.[0] as number);
      return { rowsAffected: 1 };
    }
    throw new Error("unexpected SQL: " + sql);
  }
}

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});

describe("buildListQuery", () => {
  it("filters by text across content, title and author", () => {
    const { sql, params } = buildListQuery(
      { query: "stoic", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false, tagIds: [] },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("LIKE");
    expect(sql).toContain("ESCAPE");
    expect(params[0]).toBe("%stoic%");
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("OFFSET");
  });

  it("applies book, kind and favorites filters with pagination", () => {
    const { sql, params } = buildListQuery(
      { query: "", bookId: 3, kinds: ["note"], favoritesOnly: true, editedOnly: false, tagIds: [] },
      { page: 2, pageSize: 50 },
    );
    expect(sql).toContain("b.id =");
    expect(sql).toContain("c.kind IN");
    expect(sql).toContain("f.clipping_id IS NOT NULL");
    expect(params).toContain(3);
    expect(params).toContain("note");
    // LIMIT 50 OFFSET 50
    expect(params.slice(-2)).toEqual([50, 50]);
  });

  it("matches any of several selected kinds", () => {
    const { sql, params } = buildListQuery(
      { query: "", bookId: null, kinds: ["highlight", "note"], favoritesOnly: false, editedOnly: false, tagIds: [] },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.kind IN ($1, $2)");
    expect(params.slice(0, 2)).toEqual(["highlight", "note"]);
  });

  it("selects the overlay columns for edited notes", () => {
    const { sql } = buildListQuery(
      { query: "", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false, tagIds: [] },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.content_edited, c.edited_at");
  });

  it("searches the edited text, falling back to the original", () => {
    const { sql } = buildListQuery(
      { query: "x", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false, tagIds: [] },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("COALESCE(c.content_edited_folded, c.content_folded) LIKE");
  });

  it("folds the query before matching the folded search columns", () => {
    const { sql, params } = buildListQuery(filter({ query: "CAFÉ" }), {
      page: 1,
      pageSize: 20,
    });
    expect(params.slice(0, 3)).toEqual(["%cafe%", "%cafe%", "%cafe%"]);
    expect(sql).toContain("c.content_edited_folded");
    expect(sql).toContain("c.content_folded");
    expect(sql).toContain("b.title_folded");
    expect(sql).toContain("b.author_folded");
    expect(sql).not.toContain("COALESCE(c.content_edited, c.content) LIKE");
  });

  it("keeps like wildcards literal after folding", () => {
    const { params } = buildListQuery(filter({ query: "CAFÉ 100%" }), {
      page: 1,
      pageSize: 20,
    });
    expect(params[0]).toBe("%cafe 100\\%%");
  });

  it("keeps _ and \\ literal after folding", () => {
    const { params } = buildListQuery(filter({ query: "CAFÉ_100%\\" }), {
      page: 1,
      pageSize: 20,
    });
    expect(params[0]).toBe("%cafe\\_100\\%\\\\%");
  });

  it("restricts the list to edited notes only", () => {
    const { sql } = buildListQuery(
      { query: "", bookId: null, kinds: [], favoritesOnly: false, editedOnly: true, tagIds: [] },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.content_edited IS NOT NULL");
  });

  it("keeps clippings that carry every selected tag", () => {
    const { sql, params } = buildListQuery(filter({ tagIds: [4, 9] }), {
      page: 1,
      pageSize: 20,
    });
    expect(sql).toContain(
      "SELECT COUNT(DISTINCT ct.tag_id) FROM clipping_tags ct " +
        "WHERE ct.clipping_id = c.id AND ct.tag_id IN ($1, $2)) = 2",
    );
    expect(params.slice(0, 2)).toEqual([4, 9]);
    expect(sql).not.toContain("GROUP BY");
  });

  it("deduplicates repeated tag ids so the intersection stays correct", () => {
    const { sql, params } = buildListQuery(filter({ tagIds: [4, 4] }), {
      page: 1,
      pageSize: 20,
    });
    expect(sql).toContain("ct.tag_id IN ($1)) = 1");
    expect(params[0]).toBe(4);
  });

  it("keeps its exact paginated SQL, shared select included", () => {
    const { sql, params } = buildListQuery(filter(), { page: 2, pageSize: 20 });
    // (the empty WHERE leaves a double space before ORDER BY, unchanged)
    expect(sql).toBe(
      "SELECT c.id, b.title, b.author, c.kind, c.page, c.location, " +
        "c.added_on_raw, c.added_on, c.content, c.content_hash, " +
        "c.content_edited, c.edited_at, " +
        "CASE WHEN f.clipping_id IS NULL THEN 0 ELSE 1 END AS favorite " +
        "FROM clippings c JOIN books b ON b.id = c.book_id LEFT JOIN favorites f ON f.clipping_id = c.id " +
        " ORDER BY COALESCE(c.added_on, '') DESC, c.id DESC LIMIT $1 OFFSET $2",
    );
    expect(params).toEqual([20, 20]);
  });

  it("orders oldest first without touching the pagination params", () => {
    const { sql, params } = buildListQuery(
      filter(),
      { page: 1, pageSize: 20 },
      { key: "date", dir: "asc" },
    );
    expect(sql).toContain("ORDER BY COALESCE(c.added_on, '') ASC, c.id ASC");
    expect(params).toEqual([20, 0]);
  });

  it("orders by book title ignoring case", () => {
    const { sql } = buildListQuery(
      filter(),
      { page: 1, pageSize: 20 },
      { key: "title", dir: "asc" },
    );
    expect(sql).toContain("ORDER BY b.title COLLATE NOCASE ASC");
  });

  it("orders by page and keeps unnumbered clippings last in both directions", () => {
    const asc = buildListQuery(filter(), { page: 1, pageSize: 20 }, { key: "page", dir: "asc" });
    expect(asc.sql).toContain(
      "ORDER BY CASE WHEN c.page IS NULL THEN 1 ELSE 0 END ASC, c.page ASC",
    );
    const desc = buildListQuery(filter(), { page: 1, pageSize: 20 }, { key: "page", dir: "desc" });
    expect(desc.sql).toContain(
      "ORDER BY CASE WHEN c.page IS NULL THEN 1 ELSE 0 END ASC, c.page DESC",
    );
  });
});

describe("buildCountQuery", () => {
  it("mirrors the list filters without pagination", () => {
    const { sql, params } = buildCountQuery({
      query: "x",
      bookId: null,
      kinds: [],
      favoritesOnly: true,
      editedOnly: false,
      tagIds: [],
    });
    expect(sql).toContain("COUNT");
    expect(sql).not.toContain("LIMIT");
    expect(sql).toContain("f.clipping_id IS NOT NULL");
    expect(params[0]).toBe("%x%");
  });

  it("mirrors the edited-only filter", () => {
    const { sql } = buildCountQuery({
      query: "",
      bookId: null,
      kinds: [],
      favoritesOnly: false,
      editedOnly: true,
      tagIds: [],
    });
    expect(sql).toContain("c.content_edited IS NOT NULL");
    expect(sql).not.toContain("LIMIT");
  });

  it("mirrors the tag intersection without pagination", () => {
    const { sql, params } = buildCountQuery(filter({ tagIds: [7, 8] }));
    expect(sql).toContain("SELECT COUNT(*) AS total");
    expect(sql).toContain("SELECT COUNT(DISTINCT ct.tag_id) FROM clipping_tags ct");
    expect(sql).toContain(") = 2");
    expect(sql).not.toContain("LIMIT");
    expect(params).toEqual([7, 8]);
  });
});

/** SQLite-shaped row as served by the export query (favorite 0/1). */
function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    title: "Some Book",
    author: "Some Author",
    kind: "highlight",
    page: 1,
    location: "1-2",
    added_on_raw: "raw",
    added_on: "2020-01-06T10:15:00",
    content: "Some content",
    content_hash: "hash-1",
    content_edited: null,
    edited_at: null,
    favorite: 0,
    ...overrides,
  };
}

function filter(overrides: Partial<ClippingFilter> = {}): ClippingFilter {
  return {
    query: "",
    bookId: null,
    kinds: [],
    favoritesOnly: false,
    editedOnly: false,
    tagIds: [],
    ...overrides,
  };
}

describe("exportClippings", () => {
  it("selects every filtered row without pagination, ordered by book then chronology", async () => {
    const port = new FakePort();
    plugin.port = port;
    port.clippingRows = [rawRow({ id: 1, favorite: 1 }), rawRow({ id: 2, favorite: 0 })];
    const criteria = filter({
      query: "stoic",
      bookId: 3,
      kinds: ["highlight", "note"],
      favoritesOnly: true,
      editedOnly: true,
    });

    const rows = await exportClippings(criteria);

    const call = port.selectCalls.at(-1);
    expect(call?.sql).toContain(
      "SELECT c.id, b.title, b.author, c.kind, c.page, c.location, " +
        "c.added_on_raw, c.added_on, c.content, c.content_hash, " +
        "c.content_edited, c.edited_at, " +
        "CASE WHEN f.clipping_id IS NULL THEN 0 ELSE 1 END AS favorite",
    );
    expect(call?.sql).toContain(
      "FROM clippings c JOIN books b ON b.id = c.book_id LEFT JOIN favorites f ON f.clipping_id = c.id",
    );
    expect(call?.sql).toContain(
      "ORDER BY b.title COLLATE NOCASE, COALESCE(c.added_on, '') ASC, c.id ASC",
    );
    expect(call?.sql).not.toContain("LIMIT");
    expect(call?.sql).not.toContain("OFFSET");
    expect(call?.sql).toContain("COALESCE(c.content_edited_folded, c.content_folded) LIKE");
    expect(call?.sql).toContain("f.clipping_id IS NOT NULL");
    expect(call?.sql).toContain("c.content_edited IS NOT NULL");
    // Same WHERE as the count query: every filter, in the same order, no extra params.
    expect(call?.params).toEqual(buildCountQuery(criteria).params);
    expect(rows.map((row) => row.favorite)).toEqual([true, false]);
  });

  it("maps SQLite rows to ClippingRow, keeping nulls and favorite booleans", async () => {
    const port = new FakePort();
    plugin.port = port;
    port.clippingRows = [
      rawRow({
        id: 9,
        author: null,
        page: null,
        location: null,
        added_on: null,
        content: null,
        content_edited: "edited",
        edited_at: "2026-01-01T00:00:00",
        favorite: 1,
      }),
    ];

    await expect(exportClippings(filter())).resolves.toEqual([
      {
        id: 9,
        title: "Some Book",
        author: null,
        kind: "highlight",
        page: null,
        location: null,
        added_on_raw: "raw",
        added_on: null,
        content: null,
        content_hash: "hash-1",
        content_edited: "edited",
        edited_at: "2026-01-01T00:00:00",
        favorite: true,
        tags: [],
      },
    ]);

    const call = port.selectCalls.at(-1);
    expect(call?.sql).not.toContain("WHERE");
    expect(call?.params).toEqual([]);
  });

  it("attaches each clipping's tags from one grouped query", async () => {
    const port = new FakePort();
    plugin.port = port;
    port.clippingRows = [rawRow({ id: 1 }), rawRow({ id: 2 })];
    port.tagRows = [
      { clipping_id: 1, id: 4, name: "writing" },
      { clipping_id: 1, id: 5, name: "habits" },
      { clipping_id: 2, id: 5, name: "habits" },
    ];

    const rows = await exportClippings(filter());

    expect(rows.map((row) => row.tags)).toEqual([
      [
        { id: 4, name: "writing" },
        { id: 5, name: "habits" },
      ],
      [{ id: 5, name: "habits" }],
    ]);
    expect(port.tagCalls).toHaveLength(1);
    expect(port.tagCalls[0].params).toEqual([1, 2]);
    expect(port.tagCalls[0].sql).toContain("ORDER BY ct.created_at");
  });
});

describe("listClippings", () => {
  it("hydrates the page's tags without touching the list query", async () => {
    const port = new FakePort();
    plugin.port = port;
    port.total = 2;
    port.clippingRows = [rawRow({ id: 1 }), rawRow({ id: 2, favorite: 1 })];
    port.tagRows = [{ clipping_id: 2, id: 7, name: "habits" }];

    const page = await listClippings(filter(), { page: 1, pageSize: 20 });

    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.tags)).toEqual([
      [],
      [{ id: 7, name: "habits" }],
    ]);
    expect(port.tagCalls[0].params).toEqual([1, 2]);
    expect(port.selectCalls[0].sql).toContain("LIMIT");
    expect(port.selectCalls[0].sql).not.toContain("clipping_tags");
  });

  it("skips the tag query when the page is empty", async () => {
    const port = new FakePort();
    plugin.port = port;
    port.clippingRows = [];

    const page = await listClippings(filter(), { page: 1, pageSize: 20 });

    expect(page.items).toEqual([]);
    expect(port.tagCalls).toHaveLength(0);
  });
});

describe("importParsedClippings", () => {
  it("inserts only fresh clippings and reports counts", async () => {
    const port = new FakePort();
    port.existingHashes.add("known-hash");
    const seen = clipping({ content_hash: "known-hash" });
    const fresh1 = clipping({ content_hash: "fresh-1" });
    const fresh2 = clipping({ content_hash: "fresh-2", title: "Other Book", author: null });
    const progress: number[] = [];

    const report = await importParsedClippings(
      port,
      {
        path: "/tmp/My Clippings.txt",
        fileHash: "file-1",
        clippings: [seen, fresh1, fresh2],
        skipped: 2,
      },
      (done, total) => progress.push(done / total),
    );

    expect(report.total).toBe(3);
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
    expect(report.bookCount).toBe(2);
    expect(report.alreadyImported).toBe(false);
    expect(report.skipped).toBe(2);
    expect(port.insertedClippings).toEqual(["fresh-1", "fresh-2"]);
    expect(progress.at(-1)).toBe(1);
  });

  it("stores the folded content as an extra insert column", async () => {
    const port = new FakePort();
    await importParsedClippings(
      port,
      {
        path: "/tmp/f.txt",
        fileHash: "file-fold",
        clippings: [
          clipping({ content: "Café NIÑO", content_hash: "fold-1" }),
          clipping({ title: "Other", content: null, content_hash: "fold-2" }),
        ],
        skipped: 0,
      },
      () => {},
    );

    const params = port.clippingInserts[0];
    expect(params).toHaveLength(11);
    expect(params[7]).toBe("Café NIÑO");
    expect(params[8]).toBe("fold-1");
    expect(params[10]).toBe("cafe nino");
    expect(port.clippingInserts[1][7]).toBeNull();
    expect(port.clippingInserts[1][10]).toBe("");
  });

  it("stores the folded title and author when creating a book", async () => {
    const port = new FakePort();
    await importParsedClippings(
      port,
      {
        path: "/tmp/f.txt",
        fileHash: "file-fold-books",
        clippings: [
          clipping({ title: "Æsir", author: "Straße", content_hash: "book-1" }),
          clipping({ title: "Other", author: null, content_hash: "book-2" }),
        ],
        skipped: 0,
      },
      () => {},
    );

    expect(port.bookInserts).toEqual([
      ["Æsir", "Straße", "aesir", "strasse"],
      ["Other", null, "other", ""],
    ]);
  });

  it("dedupes repeated entries inside the same batch", async () => {
    const port = new FakePort();
    const same = clipping({ content_hash: "same" });
    const report = await importParsedClippings(
      port,
      { path: "/tmp/f.txt", fileHash: "file-2", clippings: [same, { ...same }], skipped: 0 },
      () => {},
    );
    expect(report.inserted).toBe(1);
    expect(report.duplicates).toBe(1);
  });

  it("skips re-import of a known file hash with nothing new", async () => {
    const port = new FakePort();
    port.existingFiles.set("file-9", 7);
    const known = clipping({ content_hash: "dup" });
    port.existingHashes.add("dup");
    const report = await importParsedClippings(
      port,
      { path: "/tmp/f.txt", fileHash: "file-9", clippings: [known], skipped: 0 },
      () => {},
    );
    expect(report.alreadyImported).toBe(true);
    expect(report.inserted).toBe(0);
    expect(port.insertedClippings).toHaveLength(0);
    expect(port.fileUpdates).toHaveLength(0);
  });

  it("re-import of a known file picks up newly parseable clippings", async () => {
    const port = new FakePort();
    port.existingFiles.set("file-9", 7);
    const report = await importParsedClippings(
      port,
      {
        path: "/tmp/f.txt",
        fileHash: "file-9",
        clippings: [clipping({ content_hash: "new-1" })],
        skipped: 0,
      },
      () => {},
    );
    expect(report.alreadyImported).toBe(false);
    expect(report.fileId).toBe(7);
    expect(report.inserted).toBe(1);
    expect(port.insertedClippings).toEqual(["new-1"]);
    expect(port.fileUpdates).toEqual([{ id: 7, added: 1 }]);
  });
});

describe("toggleFavorite", () => {
  it("adds a missing favorite and removes an existing one", async () => {
    const port = new FakePort();
    expect(await toggleFavorite(port, 42)).toBe(true);
    expect(await toggleFavorite(port, 42)).toBe(false);
  });
});

describe("updateNote", () => {
  it("writes the overlay edit with a timestamp", async () => {
    const port = new FakePort();
    expect(await updateNote(port, 42, "edited text")).toBe(true);
    expect(port.noteEdits.get(42)).toEqual({
      content: "edited text",
      at: expect.any(String) as string,
    });
  });

  it("keeps the original content untouched and targets notes only", async () => {
    const port = new FakePort();
    await updateNote(port, 42, "edited text");
    const sql = port.executedSql.at(-1) ?? "";
    expect(sql).toContain("SET content_edited =");
    expect(sql).not.toContain("SET content =");
    expect(sql).toContain("kind = 'note'");
  });

  it("writes the folded edit next to the overlay text", async () => {
    const port = new ScriptedPort();
    await updateNote(port, 42, "CAFÉ NIÑO");
    expect(port.executed[0].sql).toContain("content_edited_folded");
    expect(port.executed[0].params).toEqual(["CAFÉ NIÑO", "cafe nino", expect.any(String), 42]);
  });

  it("reports failure when no row was affected", async () => {
    const port = new (class extends FakePort {
      public override async execute(): Promise<{ rowsAffected?: number }> {
        return { rowsAffected: 0 };
      }
    })();
    await expect(updateNote(port, 42, "x")).resolves.toBe(false);
  });
});

describe("resetNote", () => {
  it("clears the overlay edit, leaving the original intact", async () => {
    const port = new FakePort();
    expect(await resetNote(port, 42)).toBe(true);
    expect(port.noteResets).toEqual([42]);
    const sql = port.executedSql.at(-1) ?? "";
    expect(sql).toContain("content_edited = NULL");
    expect(sql).toContain("edited_at = NULL");
    expect(sql).toContain("kind = 'note'");
  });

  it("reports failure when no row was affected", async () => {
    const port = new (class extends FakePort {
      public override async execute(): Promise<{ rowsAffected?: number }> {
        return { rowsAffected: 0 };
      }
    })();
    await expect(resetNote(port, 42)).resolves.toBe(false);
  });

  it("clears the folded edit along with the overlay", async () => {
    const port = new ScriptedPort();
    await resetNote(port, 42);
    expect(port.executed[0].sql).toContain("content_edited_folded = NULL");
  });
});

describe("settings", () => {
  it("returns null for missing keys", async () => {
    const port = new FakePort();
    await expect(getSetting(port, "nope")).resolves.toBe(null);
  });

  it("roundtrips values and overwrites them", async () => {
    const port = new FakePort();
    await setSetting(port, "theme", "dark");
    await expect(getSetting(port, "theme")).resolves.toBe("dark");
    await setSetting(port, "theme", "light");
    await expect(getSetting(port, "theme")).resolves.toBe("light");
  });

  it("saves and loads filter state", async () => {
    const port = new FakePort();
    const state: StoredFilterState = {
      query: "stoic",
      bookId: 3,
      kinds: ["note"],
      favoritesOnly: true,
      editedOnly: true,
      tagIds: [3, 4],
      pageSize: 50,
    };
    await saveFilterState(port, state);
    await expect(loadFilterState(port)).resolves.toEqual(state);
  });

  it("roundtrips the clipping sort with the rest of the view state", async () => {
    const port = new FakePort();
    await saveFilterState(port, {
      query: "",
      bookId: null,
      kinds: [],
      favoritesOnly: false,
      editedOnly: false,
      pageSize: 20,
      sortBy: "page",
      sortDir: "asc",
    });
    await expect(loadFilterState(port)).resolves.toEqual({
      query: "",
      bookId: null,
      kinds: [],
      favoritesOnly: false,
      editedOnly: false,
      tagIds: [],
      pageSize: 20,
      sortBy: "page",
      sortDir: "asc",
    });
  });

  it("returns null when nothing was stored", async () => {
    const port = new FakePort();
    await expect(loadFilterState(port)).resolves.toBe(null);
  });

  it("defaults newer filters on payloads stored before they existed", async () => {
    const port = new FakePort();
    await setSetting(
      port,
      "filter",
      JSON.stringify({ query: "x", favoritesOnly: true, pageSize: 20, bookId: 3, kinds: ["note"] }),
    );
    await expect(loadFilterState(port)).resolves.toEqual({
      query: "x",
      bookId: 3,
      kinds: ["note"],
      favoritesOnly: true,
      editedOnly: false,
      tagIds: [],
      pageSize: 20,
    });
  });

  it("rejects corrupt filter payloads", async () => {
    const port = new FakePort();
    await setSetting(port, "filter", "not-json{{");
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, pageSize: 999, bookId: null, kinds: [] }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, pageSize: 20, bookId: null, kinds: ["bogus"] }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, editedOnly: "yes", pageSize: 20, bookId: null, kinds: [] }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, editedOnly: false, pageSize: 20, bookId: null, kinds: [], sortBy: "author" }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, editedOnly: false, pageSize: 20, bookId: null, kinds: [], sortDir: "up" }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, editedOnly: false, pageSize: 20, bookId: null, kinds: [], tagIds: "nope" }));
    await expect(loadFilterState(port)).resolves.toBe(null);
    await setSetting(port, "filter", JSON.stringify({ query: "x", favoritesOnly: false, editedOnly: false, pageSize: 20, bookId: null, kinds: [], tagIds: [1, "2"] }));
    await expect(loadFilterState(port)).resolves.toBe(null);
  });

  it("migrates the legacy single-kind payload", async () => {
    const port = new FakePort();
    await setSetting(
      port,
      "filter",
      JSON.stringify({ query: "", favoritesOnly: false, pageSize: 20, bookId: null, kind: "note" }),
    );
    await expect(loadFilterState(port)).resolves.toEqual({
      query: "",
      bookId: null,
      kinds: ["note"],
      favoritesOnly: false,
      editedOnly: false,
      tagIds: [],
      pageSize: 20,
    });
    await setSetting(
      port,
      "filter",
      JSON.stringify({ query: "", favoritesOnly: false, pageSize: 20, bookId: null, kind: null }),
    );
    await expect(loadFilterState(port)).resolves.toEqual({
      query: "",
      bookId: null,
      kinds: [],
      favoritesOnly: false,
      editedOnly: false,
      tagIds: [],
      pageSize: 20,
    });
  });
});

describe("backfillSearchFolding", () => {
  interface ClippingSeed {
    id: number;
    content: string | null;
    content_edited: string | null;
  }
  interface BookSeed {
    id: number;
    title: string;
    author: string | null;
  }

  /** Scripted port: serves the marker, pages by id and records every write. */
  class BackfillPort implements DbPort {
    selectCalls: Array<{ sql: string; params: unknown[] }> = [];
    writes: Array<{ sql: string; params: unknown[] }> = [];

    constructor(
      private readonly marker: string | null,
      private readonly clippings: ClippingSeed[],
      private readonly books: BookSeed[],
      private readonly failOnClippingUpdate = false,
    ) {}

    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      this.selectCalls.push({ sql, params });
      if (sql.includes("FROM settings")) {
        return (this.marker === null ? [] : [{ value: this.marker }]) as unknown as T[];
      }
      const cursor = Number(params[0] ?? 0);
      if (sql.includes("FROM clippings")) {
        return this.clippings
          .filter((row) => row.id > cursor)
          .slice(0, 100) as unknown as T[];
      }
      if (sql.includes("FROM books")) {
        return this.books
          .filter((row) => row.id > cursor)
          .slice(0, 100) as unknown as T[];
      }
      return [] as T[];
    }

    async execute(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ lastInsertId?: number; rowsAffected?: number }> {
      if (this.failOnClippingUpdate && sql.includes("UPDATE clippings")) {
        throw new Error("disk I/O error");
      }
      this.writes.push({ sql, params });
      return { rowsAffected: 1 };
    }
  }

  it("returns early without writes when the marker exists", async () => {
    const port = new BackfillPort(
      "1",
      [{ id: 1, content: "Café", content_edited: null }],
      [{ id: 1, title: "Æsir", author: null }],
    );

    await backfillSearchFolding(port);

    expect(port.selectCalls).toHaveLength(1);
    expect(port.selectCalls[0].sql).toContain("FROM settings");
    expect(port.selectCalls[0].params).toEqual([SETTINGS_KEYS.searchFolding]);
    expect(port.writes).toEqual([]);
  });

  it("pages through clippings and books, writing the marker last", async () => {
    const clippings: ClippingSeed[] = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      content: index === 1 ? null : `Café ${index + 1}`,
      content_edited: index === 0 ? "NIÑO" : null,
    }));
    const books: BookSeed[] = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      title: `Æsir ${index + 1}`,
      author: index === 0 ? null : "Straße",
    }));
    const port = new BackfillPort(null, clippings, books);

    await backfillSearchFolding(port);

    const clippingSelects = port.selectCalls.filter((call) => call.sql.includes("FROM clippings"));
    expect(clippingSelects.map((call) => call.params[0])).toEqual([0, 100, 150]);
    const bookSelects = port.selectCalls.filter((call) => call.sql.includes("FROM books"));
    expect(bookSelects.map((call) => call.params[0])).toEqual([0, 100, 120]);

    const updates = port.writes.filter((write) => write.sql.startsWith("UPDATE"));
    expect(updates).toHaveLength(270);
    expect(updates[0].sql).toContain("UPDATE clippings SET content_folded");
    expect(updates[0].params).toEqual(["cafe 1", "nino", 1]);
    expect(updates[1].params).toEqual(["", null, 2]);
    expect(updates[148].params).toEqual(["cafe 149", null, 149]);
    expect(updates[149].params).toEqual(["cafe 150", null, 150]);
    expect(updates[150].sql).toContain("UPDATE books SET title_folded");
    expect(updates[150].params).toEqual(["aesir 1", "", 1]);
    expect(updates[151].params).toEqual(["aesir 2", "strasse", 2]);

    const last = port.writes.at(-1);
    expect(last?.sql).toContain("INTO settings");
    expect(last?.params).toEqual([SETTINGS_KEYS.searchFolding, "1"]);
    expect(port.writes).toHaveLength(271);
  });

  it("folds a NULL-content bookmark as an empty string, never the word null", async () => {
    const port = new BackfillPort(
      null,
      [{ id: 1, content: null, content_edited: "CAFÉ overlay" }],
      [],
    );

    await backfillSearchFolding(port);

    const updates = port.writes.filter((write) => write.sql.startsWith("UPDATE"));
    expect(updates[0].params).toEqual(["", "cafe overlay", 1]);
    expect(port.writes.at(-1)?.params).toEqual([SETTINGS_KEYS.searchFolding, "1"]);
  });

  it("does not skip rows when ids are sparse", async () => {
    const port = new BackfillPort(
      null,
      [
        { id: 1, content: "Café", content_edited: null },
        { id: 500, content: "NIÑO", content_edited: null },
        { id: 100000, content: "Łódź", content_edited: null },
      ],
      [],
    );

    await backfillSearchFolding(port);

    const updates = port.writes.filter((write) => write.sql.startsWith("UPDATE"));
    expect(updates.map((write) => write.params[2])).toEqual([1, 500, 100000]);
    expect(updates.map((write) => write.params[0])).toEqual(["cafe", "nino", "lodz"]);
  });

  it("leaves the marker unset when an update fails midway", async () => {
    const port = new BackfillPort(
      null,
      [{ id: 1, content: "Café", content_edited: null }],
      [],
      true,
    );

    await expect(backfillSearchFolding(port)).rejects.toThrow("disk I/O error");
    expect(port.writes.some((write) => write.sql.includes("INTO settings"))).toBe(false);
  });
});

/** Scripted port for the library recipes: unlike FakePort it records the
 * exact statement order and lets each test decide what a statement returns. */
class ScriptedPort implements DbPort {
  selects: Array<{ sql: string; params: unknown[] }> = [];
  executed: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly onSelect: (sql: string, params: unknown[]) => unknown[] = () => [],
    private readonly onExecute: (
      sql: string,
      params: unknown[],
    ) => { lastInsertId?: number; rowsAffected?: number } = () => ({ rowsAffected: 1 }),
  ) {}

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.selects.push({ sql, params });
    return this.onSelect(sql, params) as T[];
  }

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ lastInsertId?: number; rowsAffected?: number }> {
    this.executed.push({ sql, params });
    return this.onExecute(sql, params);
  }
}

describe("listImportedFiles", () => {
  it("lists files newest first with a live clipping count per import", async () => {
    const rows = [
      { id: 2, path: "/b.txt", imported_at: "2026-02-01T00:00:00Z", clipping_count: 7 },
      { id: 1, path: "/a.txt", imported_at: "2026-01-01T00:00:00Z", clipping_count: 3 },
    ];
    const port = new ScriptedPort(() => rows);
    await expect(listImportedFiles(port)).resolves.toEqual(rows);

    const sql = port.selects[0].sql;
    expect(sql).toContain(
      "(SELECT COUNT(*) FROM clippings c WHERE c.file_id = f.id) AS clipping_count",
    );
    expect(sql).toContain("FROM files f");
    expect(sql).toContain("ORDER BY f.imported_at DESC");
  });
});

describe("renameBook", () => {
  it("trims the title, normalizes a blank author to null and reports renamed", async () => {
    const port = new ScriptedPort();
    await expect(renameBook(port, 5, "  Dune  ", "   ")).resolves.toEqual({ status: "renamed" });

    expect(port.selects[0].params).toEqual(["Dune", null, 5]);
    expect(port.executed).toHaveLength(1);
    expect(port.executed[0].sql).toContain("UPDATE books SET title");
    expect(port.executed[0].sql).toContain("title_folded");
    expect(port.executed[0].sql).toContain("author_folded");
    expect(port.executed[0].params).toEqual(["Dune", null, "dune", "", 5]);
  });

  it("writes the folded title and author for the search columns", async () => {
    const port = new ScriptedPort();
    await expect(renameBook(port, 5, "Café", "NIÑO")).resolves.toEqual({ status: "renamed" });
    expect(port.executed[0].params).toEqual(["Café", "NIÑO", "cafe", "nino", 5]);
  });

  it("rejects an empty title before touching the database", async () => {
    const port = new ScriptedPort();
    await expect(renameBook(port, 5, "   ", "Author")).resolves.toEqual({ status: "invalid" });
    expect(port.selects).toHaveLength(0);
    expect(port.executed).toHaveLength(0);
  });

  it("suggests the existing book when the target pair is already taken", async () => {
    const port = new ScriptedPort(() => [{ id: 9 }]);
    await expect(renameBook(port, 5, "Dune", "Herbert")).resolves.toEqual({
      status: "merge-required",
      existingBookId: 9,
    });
    expect(port.executed).toHaveLength(0);
  });

  it("reports a missing book when no row was updated", async () => {
    const port = new ScriptedPort(
      () => [],
      () => ({ rowsAffected: 0 }),
    );
    await expect(renameBook(port, 5, "Dune", null)).resolves.toEqual({ status: "missing" });
  });

  it("turns a UNIQUE race into the merge suggestion", async () => {
    let selects = 0;
    const port = new ScriptedPort(
      () => (++selects === 1 ? [] : [{ id: 12 }]),
      () => {
        throw new Error("UNIQUE constraint failed: books.title, books.author");
      },
    );
    await expect(renameBook(port, 5, "Dune", null)).resolves.toEqual({
      status: "merge-required",
      existingBookId: 12,
    });
  });

  it("rethrows unexpected database errors", async () => {
    const port = new ScriptedPort(
      () => [],
      () => {
        throw new Error("disk I/O error");
      },
    );
    await expect(renameBook(port, 5, "Dune", null)).rejects.toThrow("disk I/O error");
  });
});

describe("mergeBooks", () => {
  it("moves the clippings, then deletes the source row", async () => {
    const port = new ScriptedPort(
      () => [{ id: 2 }],
      (sql) => ({ rowsAffected: sql.startsWith("UPDATE clippings") ? 3 : 1 }),
    );
    await expect(mergeBooks(port, 1, 2)).resolves.toEqual({ status: "merged", moved: 3 });

    expect(port.executed).toHaveLength(2);
    expect(port.executed[0].sql).toContain("UPDATE clippings SET book_id");
    expect(port.executed[0].params).toEqual([2, 1]);
    expect(port.executed[1].sql).toContain("DELETE FROM books");
    expect(port.executed[1].params).toEqual([1]);
  });

  it("is a no-op when source and target are the same book", async () => {
    const port = new ScriptedPort();
    await expect(mergeBooks(port, 4, 4)).resolves.toEqual({ status: "merged", moved: 0 });
    expect(port.selects).toHaveLength(0);
    expect(port.executed).toHaveLength(0);
  });

  it("reports a missing target without touching clippings", async () => {
    const port = new ScriptedPort(() => []);
    await expect(mergeBooks(port, 1, 2)).resolves.toEqual({ status: "missing" });
    expect(port.executed).toHaveLength(0);
  });
});

describe("deleteBook", () => {
  it("deletes favorites, clippings and the book in dependency order", async () => {
    const port = new ScriptedPort(
      () => [{ n: 4 }],
      (sql) => ({ rowsAffected: sql.includes("FROM books") ? 1 : 4 }),
    );
    await expect(deleteBook(port, 7)).resolves.toBe(4);

    expect(port.selects[0].sql).toContain("COUNT(*)");
    expect(port.selects[0].sql).toContain("WHERE book_id");
    expect(port.selects[0].params).toEqual([7]);

    expect(port.executed).toHaveLength(3);
    expect(port.executed[0].sql).toContain("DELETE FROM favorites");
    expect(port.executed[0].sql).toContain("SELECT id FROM clippings WHERE book_id");
    expect(port.executed[1].sql).toContain("DELETE FROM clippings WHERE book_id");
    expect(port.executed[2].sql).toContain("DELETE FROM books WHERE id");
    expect(port.executed.every((call) => call.params[0] === 7)).toBe(true);
  });
});

describe("removeImportedFile", () => {
  it("removes the import's clippings, its empty books and the file row in order", async () => {
    const port = new ScriptedPort(
      () => [{ n: 2 }],
      (sql) => ({ rowsAffected: sql.includes("FROM books") ? 1 : 2 }),
    );
    await expect(removeImportedFile(port, 3)).resolves.toEqual({ clippings: 2, books: 1 });

    expect(port.selects[0].params).toEqual([3]);
    expect(port.executed).toHaveLength(4);
    expect(port.executed[0].sql).toContain("DELETE FROM favorites");
    expect(port.executed[1].sql).toContain("DELETE FROM clippings WHERE file_id");
    expect(port.executed[2].sql).toContain("DELETE FROM books");
    expect(port.executed[2].sql).toContain("NOT EXISTS");
    expect(port.executed[3].sql).toContain("DELETE FROM files WHERE id");
    expect(port.executed[3].params).toEqual([3]);
  });
});

describe("listTags", () => {
  it("lists tags by name ignoring case with a live clipping count", async () => {
    const rows = [
      { id: 2, name: "habits", clipping_count: 3 },
      { id: 1, name: "Writing", clipping_count: 0 },
    ];
    const port = new ScriptedPort(() => rows);

    await expect(listTags(port)).resolves.toEqual(rows);

    const sql = port.selects[0].sql;
    expect(sql).toContain("LEFT JOIN clipping_tags ct ON ct.tag_id = t.id");
    expect(sql).toContain("COUNT(ct.clipping_id) AS clipping_count");
    expect(sql).toContain("ORDER BY t.name COLLATE NOCASE");
  });
});

describe("ensureTag", () => {
  it("reuses an existing tag case-insensitively", async () => {
    const port = new ScriptedPort(() => [{ id: 5 }]);

    await expect(ensureTag(port, "  Writing ")).resolves.toBe(5);

    expect(port.selects[0].params).toEqual(["Writing"]);
    expect(port.executed).toHaveLength(0);
  });

  it("inserts a new tag with a creation timestamp", async () => {
    const port = new ScriptedPort(
      () => [],
      () => ({ lastInsertId: 8, rowsAffected: 1 }),
    );

    await expect(ensureTag(port, "habits")).resolves.toBe(8);

    expect(port.executed[0].sql).toContain("INSERT INTO tags");
    expect(port.executed[0].params[0]).toBe("habits");
    expect(port.executed[0].params[1]).toEqual(expect.any(String));
  });

  it("rejects a blank name without touching the database", async () => {
    const port = new ScriptedPort();

    await expect(ensureTag(port, "   ")).resolves.toBe(null);

    expect(port.selects).toHaveLength(0);
    expect(port.executed).toHaveLength(0);
  });
});

describe("renameTag", () => {
  it("trims the new name and reports renamed", async () => {
    const port = new ScriptedPort(() => []);

    await expect(renameTag(port, 5, "  Writing ")).resolves.toEqual({ status: "renamed" });

    expect(port.selects[0].params).toEqual(["Writing", 5]);
    expect(port.executed[0].sql).toContain("UPDATE tags SET name");
    expect(port.executed[0].params).toEqual(["Writing", 5]);
  });

  it("rejects a blank name before touching the database", async () => {
    const port = new ScriptedPort();

    await expect(renameTag(port, 5, "   ")).resolves.toEqual({ status: "invalid" });

    expect(port.selects).toHaveLength(0);
    expect(port.executed).toHaveLength(0);
  });

  it("suggests the existing tag when the name is taken", async () => {
    const port = new ScriptedPort(() => [{ id: 9 }]);

    await expect(renameTag(port, 5, "habits")).resolves.toEqual({
      status: "merge-required",
      existingTagId: 9,
    });
    expect(port.executed).toHaveLength(0);
  });

  it("reports a missing tag when no row was updated", async () => {
    const port = new ScriptedPort(
      () => [],
      () => ({ rowsAffected: 0 }),
    );

    await expect(renameTag(port, 5, "habits")).resolves.toEqual({ status: "missing" });
  });

  it("turns a UNIQUE race into the merge suggestion", async () => {
    let selects = 0;
    const port = new ScriptedPort(
      () => (++selects === 1 ? [] : [{ id: 12 }]),
      () => {
        throw new Error("UNIQUE constraint failed: tags.name");
      },
    );

    await expect(renameTag(port, 5, "habits")).resolves.toEqual({
      status: "merge-required",
      existingTagId: 12,
    });
  });
});

describe("mergeTags", () => {
  it("moves the links to the target, then deletes the source tag", async () => {
    const port = new ScriptedPort(
      () => [{ id: 2 }],
      (sql) => ({ rowsAffected: sql.startsWith("INSERT OR IGNORE") ? 3 : 1 }),
    );

    await expect(mergeTags(port, 1, 2)).resolves.toEqual({ status: "merged", moved: 3 });

    expect(port.executed).toHaveLength(2);
    expect(port.executed[0].sql).toContain("INSERT OR IGNORE INTO clipping_tags");
    expect(port.executed[0].sql).toContain(
      "SELECT clipping_id, $1, $2 FROM clipping_tags WHERE tag_id = $3",
    );
    expect(port.executed[0].params[0]).toBe(2);
    expect(port.executed[0].params[2]).toBe(1);
    expect(port.executed[1].sql).toContain("DELETE FROM tags WHERE id");
    expect(port.executed[1].params).toEqual([1]);
  });

  it("is a no-op when source and target are the same tag", async () => {
    const port = new ScriptedPort();

    await expect(mergeTags(port, 4, 4)).resolves.toEqual({ status: "merged", moved: 0 });

    expect(port.selects).toHaveLength(0);
    expect(port.executed).toHaveLength(0);
  });

  it("reports a missing target without moving anything", async () => {
    const port = new ScriptedPort(() => []);

    await expect(mergeTags(port, 1, 2)).resolves.toEqual({ status: "missing" });

    expect(port.executed).toHaveLength(0);
  });
});

describe("deleteTag", () => {
  it("deletes the tag and reports whether it existed", async () => {
    const port = new ScriptedPort(
      () => [],
      () => ({ rowsAffected: 1 }),
    );

    await expect(deleteTag(port, 4)).resolves.toBe(true);

    expect(port.executed[0].sql).toContain("DELETE FROM tags WHERE id");
    expect(port.executed[0].params).toEqual([4]);
  });

  it("reports false when the tag was already gone", async () => {
    const port = new ScriptedPort(
      () => [],
      () => ({ rowsAffected: 0 }),
    );

    await expect(deleteTag(port, 4)).resolves.toBe(false);
  });
});

describe("clipping tags", () => {
  it("assigns a tag idempotently", async () => {
    const port = new ScriptedPort();

    await addClippingTag(port, 9, 4);

    expect(port.executed[0].sql).toContain("INSERT OR IGNORE INTO clipping_tags");
    expect(port.executed[0].params[0]).toBe(9);
    expect(port.executed[0].params[1]).toBe(4);
  });

  it("removes only the requested link", async () => {
    const port = new ScriptedPort();

    await removeClippingTag(port, 9, 4);

    expect(port.executed[0].sql).toContain(
      "DELETE FROM clipping_tags WHERE clipping_id = $1 AND tag_id = $2",
    );
    expect(port.executed[0].params).toEqual([9, 4]);
  });
});

describe("loadClippingTags", () => {
  it("groups tags per clipping in link order", async () => {
    const rows = [
      { clipping_id: 1, id: 4, name: "writing" },
      { clipping_id: 1, id: 5, name: "habits" },
      { clipping_id: 2, id: 5, name: "habits" },
    ];
    const port = new ScriptedPort(() => rows);

    const map = await loadClippingTags(port, [1, 2, 1]);

    expect(map.get(1)).toEqual([
      { id: 4, name: "writing" },
      { id: 5, name: "habits" },
    ]);
    expect(map.get(2)).toEqual([{ id: 5, name: "habits" }]);
    expect(port.selects[0].params).toEqual([1, 2]);
    expect(port.selects[0].sql).toContain("ORDER BY ct.created_at");
  });

  it("skips the query when there are no clippings", async () => {
    const port = new ScriptedPort();

    await expect(loadClippingTags(port, [])).resolves.toEqual(new Map());

    expect(port.selects).toHaveLength(0);
  });
});
