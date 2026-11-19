import { describe, expect, it } from "vitest";
import { LibraryPanel, type LibraryDeps } from "./library.svelte";
import type { DbPort, ImportedFile, TagCount } from "../db";
import type { Book } from "../types";
import type { I18nKey, TranslateParams } from "../i18n";

/** Render the key with its params so a test can assert what the status line
 * says, not just which key was chosen. */
const t = (key: I18nKey, params?: TranslateParams): string => {
  const pairs = Object.entries(params ?? {}).map(([name, value]) => `${name}=${String(value)}`);
  return pairs.length === 0 ? `${key}()` : `${key}(${pairs.join(",")})`;
};

function deps(port: DbPort, refresh = async () => {}) {
  const removed: number[] = [];
  const logged: string[] = [];
  let refreshes = 0;
  const value: LibraryDeps = {
    getPort: async () => port,
    t,
    count: (noun, value) => `${value} ${noun}`,
    refresh: async () => {
      refreshes += 1;
      await refresh();
    },
    onTagRemoved: (id) => removed.push(id),
    log: (scope) => logged.push(scope),
  };
  return { value, removed, logged, refreshes: () => refreshes };
}

const workingPort: DbPort = {
  select: async <T>() =>
    [{ id: 1, path: "/kindle/a.txt", imported_at: "2026-01-01", clipping_count: 3 }] as T[],
  execute: async () => ({ rowsAffected: 1 }),
};

const failingPort: DbPort = {
  select: async () => {
    throw new Error("database is locked");
  },
  execute: async () => {
    throw new Error("database is locked");
  },
};

/** Port scripted per statement shape. The panel drives the real db layer, so
 * each test answers only the handful of statements its mutation issues. */
class ScriptedPort implements DbPort {
  readonly executed: Array<{ sql: string; params: unknown[] }> = [];
  readonly selected: Array<{ sql: string; params: unknown[] }> = [];
  /** Runs before every statement, so a test can observe the panel mid-write. */
  onStatement: (() => void) | null = null;
  #rows: Array<[string, unknown[]]> = [];
  #affected: Array<[string, number]> = [];

  /** Answer every query whose SQL contains `match` with `rows`. */
  answers(match: string, rows: unknown[]): this {
    this.#rows.push([match, rows]);
    return this;
  }

  /** Report `rowsAffected` for every statement whose SQL contains `match`. */
  affects(match: string, rowsAffected: number): this {
    this.#affected.push([match, rowsAffected]);
    return this;
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.onStatement?.();
    this.selected.push({ sql, params: params ?? [] });
    const hit = this.#rows.find(([match]) => sql.includes(match));
    return (hit?.[1] ?? []) as T[];
  }

  async execute(sql: string, params?: unknown[]) {
    this.onStatement?.();
    this.executed.push({ sql, params: params ?? [] });
    const hit = this.#affected.find(([match]) => sql.includes(match));
    return { rowsAffected: hit?.[1] ?? 1 };
  }
}

const tag: TagCount = { id: 5, name: "focus", clipping_count: 2 };
const book: Book = { id: 1, title: "Alpha", author: "Ann", clipping_count: 3 };
const file: ImportedFile = {
  id: 7,
  path: "/kindle/a.txt",
  imported_at: "2026-01-01",
  clipping_count: 4,
};

describe("LibraryPanel", () => {
  it("opens, clears the previous messages and loads the imported files", async () => {
    const { value } = deps(workingPort);
    const panel = new LibraryPanel(value);
    panel.status = "old";
    panel.error = "old error";

    await panel.show();

    expect(panel.open).toBe(true);
    expect(panel.status).toBeNull();
    expect(panel.error).toBeNull();
    expect(panel.files.map((file) => file.path)).toEqual(["/kindle/a.txt"]);
  });

  it("reports a failed file load without opening a broken dialog", async () => {
    const { value, logged } = deps(failingPort);
    const panel = new LibraryPanel(value);
    await panel.show();

    expect(panel.files).toEqual([]);
    expect(panel.error).toContain("library.error");
    expect(panel.error).toContain("database is locked");
    expect(logged).toContain("library-load");
  });

  it("runs a mutation under one busy/error policy and reloads after a failure", async () => {
    let refreshed = 0;
    const { value } = deps(failingPort, async () => {
      refreshed += 1;
    });
    const panel = new LibraryPanel(value);

    const result = await panel.rename(1, "New title", "New author");

    expect(result).toBeNull();
    expect(panel.busy).toBe(false);
    expect(panel.error).toContain("library.error");
    // The refresh keeps the dialog honest after a partially applied write.
    expect(refreshed).toBe(1);
  });

  it("closes without touching the loaded files", async () => {
    const { value } = deps(workingPort);
    const panel = new LibraryPanel(value);
    await panel.show();
    panel.close();

    expect(panel.open).toBe(false);
    expect(panel.files).toHaveLength(1);
  });

  it("holds the panel busy for the write path and releases it for the reload", async () => {
    const port = new ScriptedPort().affects("UPDATE tags SET name", 1);
    const { value } = deps(port);
    const panel = new LibraryPanel(value);
    const busyDuring: boolean[] = [];
    port.onStatement = () => busyDuring.push(panel.busy);

    await panel.renameTag(5, "deep work");

    // The collision probe and the update are locked; the reload of the file
    // list that follows only reads, so it runs with the panel released.
    expect(busyDuring).toEqual([true, true, false]);
    expect(panel.busy).toBe(false);
  });

  it("reports every mutation failure as a refusal, never as a success", async () => {
    // The port throws on any statement, so #run turns each call into a null
    // result. Every mutation must refuse, and none may touch the tag filter.
    const { value, removed } = deps(failingPort);
    const panel = new LibraryPanel(value);

    const outcomes = [
      await panel.merge(1, 2),
      await panel.removeBook(book),
      await panel.removeFile(file),
      await panel.mergeTags(5, 6),
      await panel.removeTag(tag),
    ];

    expect(outcomes).toEqual([false, false, false, false, false]);
    expect(removed).toEqual([]);
    expect(panel.error).toContain("library.error");
  });
});

describe("LibraryPanel book mutations", () => {
  it("renames a book, reports it and reloads the views", async () => {
    const port = new ScriptedPort().affects("UPDATE books SET title", 1);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.rename(1, "Alpha II", "Ann")).toEqual({ status: "renamed" });
    expect(panel.status).toContain("library.statusRenamed");
    expect(port.executed[0].params).toEqual(["Alpha II", "Ann", "alpha ii", "ann", 1]);
    expect(refreshes()).toBe(1);
  });

  it("returns a book merge offer without claiming a rename or reloading", async () => {
    const port = new ScriptedPort().answers("SELECT id FROM books WHERE title", [{ id: 2 }]);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.rename(1, "Beta", "")).toEqual({
      status: "merge-required",
      existingBookId: 2,
    });
    expect(panel.status).toBeNull();
    expect(port.executed).toEqual([]);
    expect(refreshes()).toBe(0);
  });

  it("merges books and reports how many clippings moved", async () => {
    const port = new ScriptedPort()
      .answers("SELECT id FROM books WHERE id = $1", [{ id: 2 }])
      .affects("UPDATE clippings SET book_id", 7);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.merge(1, 2)).toBe(true);
    expect(panel.status).toContain("library.statusMerged");
    expect(panel.status).toContain("count=7");
    expect(refreshes()).toBe(1);
  });

  it("reports a failed book merge without claiming a merge or reloading", async () => {
    // The target lookup finds nothing, so the source keeps its clippings.
    const port = new ScriptedPort();
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.merge(1, 2)).toBe(false);
    expect(panel.status).toBeNull();
    expect(refreshes()).toBe(0);
  });

  it("deletes a book and reports the clippings that went with it", async () => {
    const port = new ScriptedPort().answers(
      "SELECT COUNT(*) AS n FROM clippings WHERE book_id",
      [{ n: 3 }],
    );
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.removeBook(book)).toBe(true);
    expect(panel.status).toContain("library.statusDeleted");
    expect(panel.status).toContain("count=3");
    expect(refreshes()).toBe(1);
  });

  it("removes an imported file and reports both counts", async () => {
    const port = new ScriptedPort()
      .answers("SELECT COUNT(*) AS n FROM clippings WHERE file_id", [{ n: 4 }])
      .affects("DELETE FROM books WHERE NOT EXISTS", 2);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.removeFile(file)).toBe(true);
    expect(panel.status).toContain("library.statusRemoved");
    expect(panel.status).toContain("clippings=4 clipping");
    expect(panel.status).toContain("books=2 book");
    expect(refreshes()).toBe(1);
  });
});

describe("LibraryPanel tag mutations", () => {
  it("renames a tag, reports it and reloads the views", async () => {
    const port = new ScriptedPort().affects("UPDATE tags SET name", 1);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.renameTag(5, "  deep work  ")).toEqual({ status: "renamed" });
    expect(panel.status).toContain("library.statusTagRenamed");
    expect(port.executed[0].params).toEqual(["deep work", 5]);
    expect(refreshes()).toBe(1);
  });

  it("returns a tag merge offer without claiming a rename or reloading", async () => {
    const port = new ScriptedPort().answers("SELECT id FROM tags WHERE name", [{ id: 6 }]);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.renameTag(5, "later")).toEqual({
      status: "merge-required",
      existingTagId: 6,
    });
    expect(panel.status).toBeNull();
    expect(port.executed).toEqual([]);
    expect(refreshes()).toBe(0);
  });

  it("reports a missing tag without touching the status line", async () => {
    const port = new ScriptedPort().affects("UPDATE tags SET name", 0);
    const { value, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.renameTag(5, "deep work")).toEqual({ status: "missing" });
    expect(panel.status).toBeNull();
    expect(refreshes()).toBe(0);
  });

  it("merges tags, drops the source from the filter and reloads", async () => {
    const port = new ScriptedPort()
      .answers("SELECT id FROM tags WHERE id = $1", [{ id: 6 }])
      .affects("INSERT OR IGNORE INTO clipping_tags", 4);
    const { value, removed, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.mergeTags(5, 6)).toBe(true);
    expect(panel.status).toContain("library.statusTagsMerged");
    expect(panel.status).toContain("count=4");
    expect(removed).toEqual([5]);
    expect(refreshes()).toBe(1);
  });

  it("keeps the source tag in the filter when the merge finds no target", async () => {
    // Nothing moved: the tag still exists, so dropping it from the filter
    // would hide clippings that are still there.
    const port = new ScriptedPort();
    const { value, removed, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.mergeTags(5, 6)).toBe(false);
    expect(removed).toEqual([]);
    expect(panel.status).toBeNull();
    expect(refreshes()).toBe(0);
  });

  it("deletes a tag, drops it from the filter and reloads", async () => {
    const port = new ScriptedPort().affects("DELETE FROM tags", 1);
    const { value, removed, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.removeTag(tag)).toBe(true);
    expect(panel.status).toContain("library.statusTagDeleted");
    expect(removed).toEqual([5]);
    expect(refreshes()).toBe(1);
  });

  it("treats a delete of an already-gone tag as done", async () => {
    // Delete is idempotent: only a thrown error is a failure, the same policy
    // removeBook and removeFile follow. A stale row still closes the
    // confirmation panel and leaves the filter consistent with the store.
    const port = new ScriptedPort().affects("DELETE FROM tags", 0);
    const { value, removed, refreshes } = deps(port);
    const panel = new LibraryPanel(value);

    expect(await panel.removeTag(tag)).toBe(true);
    expect(panel.status).toContain("library.statusTagDeleted");
    expect(removed).toEqual([5]);
    expect(refreshes()).toBe(1);
  });
});
