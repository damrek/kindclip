import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { importParsedClippings, buildListQuery, buildSearchQuery, type DbPort } from "./db";
import { loadReadingStats, TOP_BOOKS } from "./stats";
import type { ClippingDto } from "./types";

/** Applied in order, exactly like tauri-plugin-sql does at startup. */
const MIGRATIONS = [
  "001_init.sql",
  "002_settings.sql",
  "003_note_editing.sql",
  "004_tags.sql",
  "005_search_folding.sql",
];

function schema(): string {
  return MIGRATIONS.map((name) =>
    readFileSync(new URL(`../../src-tauri/migrations/${name}`, import.meta.url), "utf8"),
  ).join("\n");
}

/**
 * `DbPort` over a real in-memory SQLite. Placeholders are bound the same way
 * sqlx does in tauri-plugin-sql: `$N` names resolve to the N-th supplied value,
 * so a repeated `$N` reuses one value no matter how many values were pushed.
 */
class SqlitePort implements DbPort {
  readonly executedSql: string[] = [];
  private readonly db = new DatabaseSync(":memory:");

  constructor() {
    this.db.exec(schema());
  }

  private bind(
    sql: string,
    params?: unknown[],
  ): Record<string, string | number | null> | undefined {
    if (!params || params.length === 0) return undefined;
    const names = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    if (names.length === 0) return undefined;
    const bound: Record<string, string | number | null> = {};
    // SQLite counts each distinct name once; only the declared names are bound.
    for (let index = 1; index <= Math.max(...names); index += 1) {
      const value = params[index - 1];
      bound[String(index)] =
        typeof value === "number" || typeof value === "string"
          ? value
          : value === null || value === undefined
            ? null
            : String(value);
    }
    return bound;
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.executedSql.push(sql);
    const statement = this.db.prepare(sql);
    const bound = this.bind(sql, params);
    const rows = bound === undefined ? statement.all() : statement.all(bound);
    return rows as T[];
  }

  async execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId?: number; rowsAffected?: number }> {
    this.executedSql.push(sql);
    const statement = this.db.prepare(sql);
    const bound = this.bind(sql, params);
    const result = bound === undefined ? statement.run() : statement.run(bound);
    return {
      lastInsertId: Number(result.lastInsertRowid),
      rowsAffected: Number(result.changes),
    };
  }

  count(sql: string): number {
    return Number((this.db.prepare(sql).get() as { n: number }).n);
  }
}

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
    content_hash: "hash-1",
    ...overrides,
  };
}

describe("importParsedClippings against real SQLite", () => {
  it("inserts every fresh clipping through one multi-row statement", async () => {
    const port = new SqlitePort();
    const clippings = [
      clipping({ content: "First highlight", content_hash: "hash-1", page: 10 }),
      clipping({ content: "Second highlight", content_hash: "hash-2", page: 20 }),
      // Same hash again: must be dropped by the Set before the statement.
      clipping({ content: "First highlight", content_hash: "hash-1", page: 10 }),
    ];

    const report = await importParsedClippings(
      port,
      { path: "/kindle/My Clippings.txt", fileHash: "file-1", clippings, skipped: 0 },
      () => {},
    );

    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
    expect(report.bookCount).toBe(1);
    expect(report.alreadyImported).toBe(false);
    expect(port.count("SELECT COUNT(*) AS n FROM clippings")).toBe(2);
    expect(port.count("SELECT COUNT(DISTINCT content_hash) AS n FROM clippings")).toBe(2);
    expect(port.count("SELECT COUNT(*) AS n FROM files")).toBe(1);
    expect(port.count("SELECT clipping_count AS n FROM files")).toBe(2);

    const statement = port.executedSql.find((sql) => sql.includes("INSERT INTO clippings"));
    expect(statement).toBeDefined();

    // A re-import of the same file must not duplicate rows nor fail on UNIQUE.
    const again = await importParsedClippings(
      port,
      { path: "/kindle/My Clippings.txt", fileHash: "file-1", clippings, skipped: 0 },
      () => {},
    );
    expect(again.inserted).toBe(0);
    expect(again.alreadyImported).toBe(true);
    expect(port.count("SELECT COUNT(*) AS n FROM clippings")).toBe(2);
  });

  it("splits more than 500 fresh clippings into two valid statements", async () => {
    const port = new SqlitePort();
    const clippings = Array.from({ length: 501 }, (_, index) =>
      clipping({
        title: `Book ${index % 3}`,
        content_hash: `hash-${index}`,
        content: `Content ${index}`,
      }),
    );

    const report = await importParsedClippings(
      port,
      { path: "/kindle/My Clippings.txt", fileHash: "file-big", clippings, skipped: 0 },
      () => {},
    );

    expect(report.inserted).toBe(501);
    expect(port.count("SELECT COUNT(*) AS n FROM clippings")).toBe(501);
    expect(port.count("SELECT COUNT(*) AS n FROM books")).toBe(3);
    const statements = port.executedSql.filter((sql) => sql.includes("INSERT INTO clippings"));
    expect(statements).toHaveLength(2);
    // 500 rows * 11 columns = 5,500 parameters, below SQLite's 32,766 limit.
    const firstChunkNames = [...statements[0].matchAll(/\$(\d+)/g)];
    expect(Math.max(...firstChunkNames.map((match) => Number(match[1])))).toBe(5_500);
  });
});

describe("multi-word search against real SQLite", () => {
  it("requires every word, each one in any field and in any order", async () => {
    const port = new SqlitePort();
    await importParsedClippings(
      port,
      {
        path: "/kindle/My Clippings.txt",
        fileHash: "file-search",
        skipped: 0,
        clippings: [
          clipping({
            title: "Meditations",
            author: "Marcus Aurelius",
            content: "A stoic aurora",
            content_hash: "both-content",
          }),
          clipping({
            title: "Aurora",
            author: "Someone",
            content: "Just stoic",
            content_hash: "title-and-content",
          }),
          clipping({
            title: "Other",
            author: "Nobody",
            content: "Aurora only",
            content_hash: "one-word",
          }),
          clipping({
            title: "Stoic",
            author: "Aurora",
            kind: "bookmark",
            content: null,
            content_hash: "title-and-author",
          }),
        ],
      },
      () => {},
    );

    const { sql, params } = buildListQuery(
      {
        query: "aurora  STOIC",
        bookId: null,
        kinds: [],
        favoritesOnly: false,
        editedOnly: false,
        tagIds: [],
      },
      { page: 1, pageSize: 20 },
    );
    const rows = await port.select<{ content_hash: string }>(sql, params);

    expect(rows.map((row) => row.content_hash).sort()).toEqual([
      "both-content",
      "title-and-author",
      "title-and-content",
    ]);
  });
});

describe("global palette search against real SQLite", () => {
  async function seed(port: SqlitePort): Promise<void> {
    await importParsedClippings(
      port,
      {
        path: "/kindle/My Clippings.txt",
        fileHash: "file-palette",
        skipped: 0,
        clippings: [
          clipping({
            title: "Meditations",
            author: "Marcus Aurelius",
            content: "A stoic aurora",
            added_on: "2021-01-01T10:00:00",
            content_hash: "palette-1",
          }),
          clipping({
            title: "Aurora",
            author: "Someone",
            content: "Just stoic",
            added_on: "2020-01-01T10:00:00",
            content_hash: "palette-2",
          }),
          clipping({
            title: "Other",
            author: "Nobody",
            content: "Aurora only",
            added_on: "2022-01-01T10:00:00",
            content_hash: "palette-3",
          }),
          clipping({
            title: "Stoic",
            author: "Aurora",
            kind: "bookmark",
            content: null,
            added_on: "2019-01-01T10:00:00",
            content_hash: "palette-4",
          }),
          clipping({
            title: "Café",
            author: "Crème",
            content: "Crème brûlée",
            added_on: "2023-01-01T10:00:00",
            content_hash: "palette-5",
          }),
        ],
      },
      () => {},
    );
  }

  it("requires every term across content, title and author, newest first", async () => {
    const port = new SqlitePort();
    await seed(port);

    const { sql, params } = buildSearchQuery("aurora  STOIC", 10);
    const rows = await port.select<{ content_hash: string; content: string | null }>(
      sql,
      params,
    );

    expect(rows.map((row) => row.content_hash)).toEqual([
      "palette-1",
      "palette-2",
      "palette-4",
    ]);
    // A bookmark with no text still matches through its title and author.
    expect(rows[2].content).toBeNull();
  });

  it("folds accents and case like the list search", async () => {
    const port = new SqlitePort();
    await seed(port);

    const { sql, params } = buildSearchQuery("creme BRULEE", 10);
    const rows = await port.select<{ content_hash: string }>(sql, params);

    expect(rows.map((row) => row.content_hash)).toEqual(["palette-5"]);
  });

  it("caps the result count and keeps the newest first for the empty query", async () => {
    const port = new SqlitePort();
    await seed(port);

    const { sql, params } = buildSearchQuery("", 2);
    const rows = await port.select<{ content_hash: string }>(sql, params);

    expect(rows.map((row) => row.content_hash)).toEqual(["palette-5", "palette-3"]);
  });
});

describe("reading stats against real SQLite", () => {
  async function seed(port: SqlitePort): Promise<void> {
    await importParsedClippings(
      port,
      {
        path: "/kindle/My Clippings.txt",
        fileHash: "file-stats",
        skipped: 0,
        clippings: [
          clipping({
            title: "Meditations",
            author: "Marcus",
            added_on: "2020-01-06T10:15:00",
            content_hash: "stats-1",
          }),
          clipping({
            title: "Meditations",
            author: "Marcus",
            added_on: "2021-03-02T10:15:00",
            content_hash: "stats-2",
          }),
          clipping({
            title: "Meditations",
            author: "Marcus",
            kind: "note",
            added_on: "2021-05-05T10:15:00",
            content_hash: "stats-3",
          }),
          clipping({
            title: "Other",
            author: null,
            kind: "bookmark",
            added_on: "2021-06-01T10:15:00",
            content_hash: "stats-4",
          }),
          clipping({
            title: "Other",
            author: null,
            added_on: null,
            content_hash: "stats-5",
          }),
        ],
      },
      () => {},
    );
  }

  it("groups clippings by year, kind and book, with undated clippings last", async () => {
    const port = new SqlitePort();
    await seed(port);

    const stats = await loadReadingStats(port);

    expect(stats.total).toBe(5);
    expect(stats.bookCount).toBe(2);
    expect(stats.years).toEqual([
      { year: "2021", count: 3 },
      { year: "2020", count: 1 },
      { year: null, count: 1 },
    ]);
    expect(stats.kinds).toEqual([
      { kind: "highlight", count: 3 },
      { kind: "bookmark", count: 1 },
      { kind: "note", count: 1 },
    ]);
    expect(stats.books).toEqual([
      { title: "Meditations", author: "Marcus", count: 3 },
      { title: "Other", author: null, count: 2 },
    ]);
  });

  it("keeps the book list bounded and breaks ties by title", async () => {
    const port = new SqlitePort();
    await importParsedClippings(
      port,
      {
        path: "/kindle/My Clippings.txt",
        fileHash: "file-many-books",
        skipped: 0,
        clippings: Array.from({ length: 10 }, (_, index) =>
          clipping({
            title: `Book ${String(index).padStart(2, "0")}`,
            author: null,
            added_on: "2022-01-01T00:00:00",
            content_hash: `many-${index}`,
          }),
        ),
      },
      () => {},
    );

    const stats = await loadReadingStats(port);

    expect(stats.books).toHaveLength(TOP_BOOKS);
    expect(stats.books.map((book) => book.title)).toEqual([
      "Book 00",
      "Book 01",
      "Book 02",
      "Book 03",
      "Book 04",
      "Book 05",
      "Book 06",
      "Book 07",
    ]);
  });
});
