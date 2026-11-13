import { describe, expect, it } from "vitest";
import { BookShelf, ClippingList } from "./catalog.svelte";
import { emptyFilter } from "../library";
import { DEFAULT_CLIPPING_SORT, type ClippingSort } from "../sorting";
import type { Book, ClippingFilter, ClippingRow, PagedResult, PageRequest } from "../types";

function row(id: number): ClippingRow {
  return {
    id,
    title: "Book",
    author: null,
    kind: "highlight",
    page: id,
    location: null,
    added_on_raw: "",
    added_on: null,
    content: `row ${id}`,
    content_hash: `hash-${id}`,
    content_edited: null,
    edited_at: null,
    favorite: false,
    tags: [],
  };
}

function pageOf(ids: number[], total = ids.length): PagedResult<ClippingRow> {
  return { items: ids.map(row), total, page: 1, pageSize: 20 };
}

const sort: ClippingSort = DEFAULT_CLIPPING_SORT;

function listWith(loader: (filter: ClippingFilter, page: PageRequest) => Promise<PagedResult<ClippingRow>>) {
  const logged: string[] = [];
  const list = new ClippingList(
    (filter, page, requestedSort) => {
      expect(requestedSort).toEqual(sort);
      return loader(filter, page);
    },
    (scope) => logged.push(scope),
  );
  return { list, logged };
}

describe("ClippingList.reload", () => {
  it("commits rows, the filter that produced them and the sort", async () => {
    const { list } = listWith(async () => pageOf([1, 2], 40));
    const filter = { ...emptyFilter(), kinds: ["note" as const] };
    await list.reload(filter, 20, sort);

    expect(list.result?.items.map((item) => item.id)).toEqual([1, 2]);
    expect(list.resultFilter.kinds).toEqual(["note"]);
    expect(list.resultFilter).not.toBe(filter); // defensive copy
    expect(list.resultSort).toEqual(sort);
    expect(list.loading).toBe(false);
    expect(list.error).toBeNull();
  });

  it("clamps to the last page and refetches it when the total shrinks", async () => {
    const calls: number[] = [];
    const { list } = listWith(async (_filter, page) => {
      calls.push(page.page);
      return page.page === 5 ? pageOf([], 3) : pageOf([1, 2, 3], 3);
    });
    list.page = 5;
    await list.reload(emptyFilter(), 20, sort);

    expect(calls).toEqual([5, 1]);
    expect(list.page).toBe(1);
    expect(list.result?.items).toHaveLength(3);
  });

  it("ignores a slow response that a newer load superseded", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const { list } = listWith(async () => {
      call += 1;
      if (call === 1) {
        await slow;
        return pageOf([99], 1);
      }
      return pageOf([1], 1);
    });

    const first = list.reload(emptyFilter(), 20, sort);
    const second = list.reload(emptyFilter(), 20, sort);
    await second;
    release();
    await first;

    expect(list.result?.items.map((item) => item.id)).toEqual([1]);
    expect(list.loading).toBe(false);
  });

  it("reports a failure and releases the busy flag", async () => {
    const { list, logged } = listWith(async () => {
      throw new Error("database is locked");
    });
    await list.reload(emptyFilter(), 20, sort);

    expect(list.error).toBe("database is locked");
    expect(list.loading).toBe(false);
    expect(logged).toContain("list-load");
  });
});

describe("ClippingList.patch / lost", () => {
  it("patches one row and reports a lost selection", async () => {
    const { list } = listWith(async () => pageOf([1, 2], 2));
    await list.reload(emptyFilter(), 20, sort);

    list.patch(2, (row) => ({ ...row, favorite: true }));
    expect(list.result?.items[1].favorite).toBe(true);

    expect(list.lost(null)).toBe(false);
    expect(list.lost(2)).toBe(false);
    expect(list.lost(7)).toBe(true);
  });
});

describe("BookShelf", () => {
  it("loads once and reports the failure message otherwise", async () => {
    const books: Book[] = [{ id: 1, title: "A", author: null, clipping_count: 2 }];
    const shelf = new BookShelf(async () => books, () => {});
    await expect(shelf.reload()).resolves.toBeNull();
    expect(shelf.loaded).toBe(true);
    expect(shelf.has(1)).toBe(true);
    expect(shelf.has(2)).toBe(false);

    const failing = new BookShelf(
      async () => {
        throw new Error("no db");
      },
      () => {},
    );
    await expect(failing.reload()).resolves.toBe("no db");
    expect(failing.loaded).toBe(false);
  });
});
