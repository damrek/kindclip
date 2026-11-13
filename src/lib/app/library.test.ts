import { describe, expect, it } from "vitest";
import { LibraryPanel, type LibraryDeps } from "./library.svelte";
import type { DbPort } from "../db";
import type { I18nKey, TranslateParams } from "../i18n";

const t = (key: I18nKey, params?: TranslateParams): string =>
  `${key}:${String(params?.message ?? "")}`;

function deps(port: DbPort, refresh = async () => {}) {
  const removed: number[] = [];
  const logged: string[] = [];
  const value: LibraryDeps = {
    getPort: async () => port,
    t,
    count: (noun, value) => `${value} ${noun}`,
    refresh,
    onTagRemoved: (id) => removed.push(id),
    log: (scope) => logged.push(scope),
  };
  return { value, removed, logged };
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
});
