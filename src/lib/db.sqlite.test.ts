import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { importParsedClippings, type DbPort } from "./db";
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
