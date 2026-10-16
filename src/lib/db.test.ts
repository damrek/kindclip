import { describe, expect, it, vi } from "vitest";
import {
  buildCountQuery,
  buildListQuery,
  escapeLike,
  exportClippings,
  getSetting,
  importParsedClippings,
  loadFilterState,
  resetNote,
  saveFilterState,
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
  fileUpdates: Array<{ id: number; added: number }> = [];
  noteEdits = new Map<number, { content: string; at: string }>();
  noteResets: number[] = [];
  executedSql: string[] = [];
  /** Rows served to the export query, in SQLite shape (favorite 0/1). */
  clippingRows: unknown[] = [];
  selectCalls: Array<{ sql: string; params: unknown[] }> = [];
  lastId = 100;
  fileId = 7;

  async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
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
      this.insertedClippings.push(params?.[8] as string);
      return { lastInsertId: ++this.lastId, rowsAffected: 1 };
    }
    if (sql.includes("INSERT INTO books")) {
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
        this.noteEdits.set(params?.[2] as number, {
          content: params?.[0] as string,
          at: params?.[1] as string,
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
      { query: "stoic", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false },
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
      { query: "", bookId: 3, kinds: ["note"], favoritesOnly: true, editedOnly: false },
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
      { query: "", bookId: null, kinds: ["highlight", "note"], favoritesOnly: false, editedOnly: false },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.kind IN ($1, $2)");
    expect(params.slice(0, 2)).toEqual(["highlight", "note"]);
  });

  it("selects the overlay columns for edited notes", () => {
    const { sql } = buildListQuery(
      { query: "", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.content_edited, c.edited_at");
  });

  it("searches the edited text, falling back to the original", () => {
    const { sql } = buildListQuery(
      { query: "x", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("COALESCE(c.content_edited, c.content) LIKE");
  });

  it("restricts the list to edited notes only", () => {
    const { sql } = buildListQuery(
      { query: "", bookId: null, kinds: [], favoritesOnly: false, editedOnly: true },
      { page: 1, pageSize: 20 },
    );
    expect(sql).toContain("c.content_edited IS NOT NULL");
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
});

describe("buildCountQuery", () => {
  it("mirrors the list filters without pagination", () => {
    const { sql, params } = buildCountQuery({
      query: "x",
      bookId: null,
      kinds: [],
      favoritesOnly: true,
      editedOnly: false,
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
    });
    expect(sql).toContain("c.content_edited IS NOT NULL");
    expect(sql).not.toContain("LIMIT");
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
    expect(call?.sql).toContain("COALESCE(c.content_edited, c.content) LIKE");
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
      },
    ]);

    const call = port.selectCalls.at(-1);
    expect(call?.sql).not.toContain("WHERE");
    expect(call?.params).toEqual([]);
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
      { path: "/tmp/My Clippings.txt", fileHash: "file-1", clippings: [seen, fresh1, fresh2] },
      (done, total) => progress.push(done / total),
    );

    expect(report.total).toBe(3);
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
    expect(report.bookCount).toBe(2);
    expect(report.alreadyImported).toBe(false);
    expect(port.insertedClippings).toEqual(["fresh-1", "fresh-2"]);
    expect(progress.at(-1)).toBe(1);
  });

  it("dedupes repeated entries inside the same batch", async () => {
    const port = new FakePort();
    const same = clipping({ content_hash: "same" });
    const report = await importParsedClippings(
      port,
      { path: "/tmp/f.txt", fileHash: "file-2", clippings: [same, { ...same }] },
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
      { path: "/tmp/f.txt", fileHash: "file-9", clippings: [known] },
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
      { path: "/tmp/f.txt", fileHash: "file-9", clippings: [clipping({ content_hash: "new-1" })] },
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
      pageSize: 50,
    };
    await saveFilterState(port, state);
    await expect(loadFilterState(port)).resolves.toEqual(state);
  });

  it("returns null when nothing was stored", async () => {
    const port = new FakePort();
    await expect(loadFilterState(port)).resolves.toBe(null);
  });

  it("defaults the edited filter to false on payloads stored before it existed", async () => {
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
      pageSize: 20,
    });
  });
});
