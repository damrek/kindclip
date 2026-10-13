import { describe, expect, it } from "vitest";
import {
  buildCountQuery,
  buildListQuery,
  escapeLike,
  importParsedClippings,
  toggleFavorite,
  type DbPort,
} from "./db";
import type { ClippingDto } from "./types";

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
  insertedClippings: string[] = [];
  fileUpdates: Array<{ id: number; added: number }> = [];
  lastId = 100;
  fileId = 7;

  async select<T>(sql: string): Promise<T[]> {
    if (sql.includes("content_hash")) {
      return [...this.existingHashes].map((h) => ({ content_hash: h }) as T);
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
      { query: "stoic", bookId: null, kind: null, favoritesOnly: false },
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
      { query: "", bookId: 3, kind: "note", favoritesOnly: true },
      { page: 2, pageSize: 50 },
    );
    expect(sql).toContain("b.id =");
    expect(sql).toContain("c.kind =");
    expect(sql).toContain("f.clipping_id IS NOT NULL");
    expect(params).toContain(3);
    expect(params).toContain("note");
    // LIMIT 50 OFFSET 50
    expect(params.slice(-2)).toEqual([50, 50]);
  });
});

describe("buildCountQuery", () => {
  it("mirrors the list filters without pagination", () => {
    const { sql, params } = buildCountQuery({
      query: "x",
      bookId: null,
      kind: null,
      favoritesOnly: true,
    });
    expect(sql).toContain("COUNT");
    expect(sql).not.toContain("LIMIT");
    expect(sql).toContain("f.clipping_id IS NOT NULL");
    expect(params[0]).toBe("%x%");
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
