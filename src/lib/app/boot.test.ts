import { describe, expect, it, vi } from "vitest";
import { ShellBoot, type ShellBootDeps } from "./boot.svelte";
import { BookShelf, ClippingList } from "./catalog.svelte";
import { Overlays, type OverlayDom } from "./overlays.svelte";
import type { Preferences } from "./preferences.svelte";
import type { SnapshotState } from "./snapshot.svelte";
import type { DbPort } from "../db";
import { emptyFilters, toStored } from "../filters";
import type { TagCount } from "../db";
import type { Book } from "../types";

function dom(): OverlayDom {
  return {
    activeElement: () => null,
    focus: () => {},
    blurActive: () => {},
    afterRender: async () => {},
  };
}

function prefs(persistSetting: () => Promise<void> = async () => {}): Preferences {
  return {
    hydrate: async () => {},
    persistSetting,
    applyCurrentFont: () => {},
    applyCurrentTheme: () => {},
    locale: "en",
    autoBackupEnabled: true,
  } as unknown as Preferences;
}

function make(overrides: Partial<ShellBootDeps> = {}, port?: DbPort) {
  const list = new ClippingList(
    async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    () => {},
  );
  const shelf = new BookShelf(async () => [], () => {});
  const tags: TagCount[] = [];
  let resets = 0;
  const deps: ShellBootDeps = {
    prefs: prefs(),
    list,
    shelf,
    overlays: new Overlays(dom()),
    snapshot: { autoBackup: async () => {} } as unknown as SnapshotState,
    getPort: async () => port ?? fakePort([], []),
    setTags: (next) => tags.push(...next),
    autoBackupEnabled: () => false,
    resetPage: () => {
      resets += 1;
    },
    ...overrides,
  };
  return { boot: new ShellBoot(deps), list, tags, resets: () => resets, deps };
}

function fakePort(tags: TagCount[], settings: Array<{ key: string; value: string }>): DbPort {
  return {
    select: async <T>(sql: string) => {
      if (sql.includes("FROM tags")) return tags as T[];
      if (sql.includes("FROM settings")) return settings as T[];
      return [] as T[];
    },
    execute: async () => ({ rowsAffected: 1 }),
  };
}

function book(id: number): Book {
  return { id, title: `Book ${id}`, author: null, clipping_count: 1 };
}

describe("ShellBoot", () => {
  it("falls back to all books when the persisted book is gone", async () => {
    const shelf = new BookShelf(async () => [book(2)], () => {});
    const { boot } = make({ shelf });
    boot.filters.values.bookId = 1;

    await boot.loadBooks();

    expect(boot.filters.values.bookId).toBeNull();
  });

  it("reports a shelf failure on the list", async () => {
    const shelf = new BookShelf(async () => {
      throw new Error("database is locked");
    }, () => {});
    const { boot, list } = make({ shelf });

    await boot.loadBooks();

    expect(list.error).toBe("database is locked");
  });

  it("hydrates the stored filter, publishes the tags and becomes ready", async () => {
    const stored = { ...toStored(emptyFilters()), kinds: ["note"], tagIds: [7] };
    const port = fakePort([{ id: 7, name: "tag", clipping_count: 2 }], [
      { key: "filter", value: JSON.stringify(stored) },
    ]);
    const { boot, tags } = make({}, port);

    await boot.hydrate();

    expect(boot.ready).toBe(true);
    expect(boot.filters.values.kinds).toEqual(["note"]);
    expect(boot.filters.values.tagIds).toEqual([7]);
    expect(tags.map((tag) => tag.id)).toEqual([7]);
  });

  it("writes the defaults when nothing is stored and is ready even on failure", async () => {
    const persist = vi.fn(async () => {});
    const { boot } = make({ prefs: prefs(persist) });

    await boot.hydrate();
    expect(boot.ready).toBe(true);
    expect(persist).toHaveBeenCalledWith("filter", expect.any(String));

    const failing = make({
      getPort: async () => {
        throw new Error("no database");
      },
    }).boot;
    await failing.hydrate();
    expect(failing.ready).toBe(true);
  });

  it("drops tag ids whose tag is gone", async () => {
    const stored = { ...toStored(emptyFilters()), tagIds: [7, 9] };
    const port = fakePort([{ id: 7, name: "tag", clipping_count: 1 }], [
      { key: "filter", value: JSON.stringify(stored) },
    ]);
    const { boot } = make({}, port);

    await boot.hydrate();

    expect(boot.filters.values.tagIds).toEqual([7]);
  });
});
