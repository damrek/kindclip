import { describe, expect, it, vi } from "vitest";
import {
  applyFavoriteToggle,
  applyNoteEdit,
  clampPage,
  copyClippingContent,
  debounce,
  emptyFilter,
  formatAddedOn,
  filterBooks,
  formatReference,
  PAGE_SIZES,
  pageWindow,
  tagOverflow,
  totalClippings,
  totalPages,
  withTag,
  withoutTag,
  withoutTagId,
} from "./library";
import type { ClippingRow, Tag } from "./types";
import type { Book } from "./types";

describe("totalPages", () => {
  it("computes page counts", () => {
    expect(totalPages(0, 20)).toBe(0);
    expect(totalPages(1, 20)).toBe(1);
    expect(totalPages(20, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(100, 50)).toBe(2);
  });
});

describe("clampPage", () => {
  it("keeps the page inside 1..totalPages", () => {
    expect(clampPage(3, 100, 20)).toBe(3);
    expect(clampPage(9, 100, 20)).toBe(5);
    expect(clampPage(0, 100, 20)).toBe(1);
    expect(clampPage(-4, 100, 20)).toBe(1);
    expect(clampPage(1, 0, 20)).toBe(1);
  });
});

describe("pageWindow", () => {
  it("shows every page when they fit", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses distant pages with ellipses", () => {
    expect(pageWindow(5, 10)).toEqual([1, 2, "…", 4, 5, 6, "…", 9, 10]);
    expect(pageWindow(1, 20)).toEqual([1, 2, "…", 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, 2, "…", 19, 20]);
  });
});

describe("debounce", () => {
  it("calls once with the latest args after the delay", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);
      debounced("a");
      debounced("b");
      vi.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending call", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);
      debounced("a");
      debounced.cancel();
      vi.advanceTimersByTime(500);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("emptyFilter", () => {
  it("returns the default filter", () => {
    expect(emptyFilter()).toEqual({ query: "", bookId: null, kinds: [], favoritesOnly: false, editedOnly: false, tagIds: [] });
  });
});

describe("PAGE_SIZES", () => {
  it("offers 20/50/100", () => {
    expect(PAGE_SIZES).toEqual([20, 50, 100]);
  });
});

describe("formatReference", () => {
  it("combines page and location", () => {
    expect(formatReference(12, "234-236")).toBe("p. 12 · pos. 234-236");
    expect(formatReference(null, "100-101")).toBe("pos. 100-101");
    expect(formatReference(3, null)).toBe("p. 3");
    expect(formatReference(null, null)).toBe("");
  });
});

describe("formatAddedOn", () => {
  it("falls back to raw when there is no normalized date", () => {
    expect(formatAddedOn(null, "raw")).toBe("raw");
    expect(formatAddedOn(null, "")).toBe("");
  });

  it("renders the normalized date with year", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw")).toContain("2020");
  });

  it("renders month names in the requested locale", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw", "en-US")).toContain("Jan");
  });

  it("falls back to raw on garbage", () => {
    expect(formatAddedOn("not-a-date", "raw")).toBe("raw");
  });
});

function row(id: number, favorite: boolean): ClippingRow {
  return {
    id,
    title: "B",
    author: null,
    kind: "highlight",
    page: null,
    location: null,
    added_on_raw: "",
    added_on: null,
    content: "c",
    content_hash: `h${id}`,
    favorite,
    content_edited: null,
    edited_at: null,
    tags: [],
  };
}

describe("applyFavoriteToggle", () => {
  it("flips the favorite flag of one row, keeping the rest", () => {
    const items = [row(1, false), row(2, true)];
    expect(applyFavoriteToggle(items, 1, true)).toEqual([row(1, true), row(2, true)]);
    expect(applyFavoriteToggle(items, 2, false)).toEqual([row(1, false), row(2, false)]);
  });

  it("leaves unknown ids untouched", () => {
    const items = [row(1, false)];
    expect(applyFavoriteToggle(items, 99, true)).toEqual(items);
  });
});

describe("applyNoteEdit", () => {
  it("patches the overlay columns of the matching row", () => {
    const items = [row(1, false), row(2, false)];
    const patched = applyNoteEdit(items, 2, { content_edited: "new", edited_at: "2026-10-15" });
    expect(patched[1]).toEqual({ ...row(2, false), content_edited: "new", edited_at: "2026-10-15" });
    expect(patched[0]).toEqual(row(1, false));
  });

  it("reset passes nulls through and clears a previous edit", () => {
    const edited = { ...row(1, false), content_edited: "old edit", edited_at: "2026-01-01" };
    const patched = applyNoteEdit([edited], 1, { content_edited: null, edited_at: null });
    expect(patched[0]).toEqual(row(1, false));
  });

  it("leaves unknown ids untouched", () => {
    const items = [row(1, false)];
    expect(applyNoteEdit(items, 99, { content_edited: "x", edited_at: null })).toEqual(items);
  });
});

describe("copyClippingContent", () => {
  it("returns true when the write succeeds", async () => {
    await expect(copyClippingContent(async () => {}, "text")).resolves.toBe(true);
  });

  it("returns false when the write fails", async () => {
    const denied = async (): Promise<void> => {
      throw new Error("denied");
    };
    await expect(copyClippingContent(denied, "text")).resolves.toBe(false);
  });
});

describe("totalClippings", () => {
  it("sums clipping counts across books", () => {
    const books: Book[] = [
      { id: 1, title: "A", author: null, clipping_count: 10 },
      { id: 2, title: "B", author: "X", clipping_count: 5 },
    ];
    expect(totalClippings(books)).toBe(15);
  });

  it("is zero for an empty library", () => {
    expect(totalClippings([])).toBe(0);
  });
});

describe("filterBooks", () => {
  const books: Book[] = [
    { id: 1, title: "Cien años de soledad", author: "Gabriel García Márquez", clipping_count: 5 },
    { id: 2, title: "Rayuela", author: "Julio Cortázar", clipping_count: 2 },
    { id: 3, title: "El túnel", author: null, clipping_count: 1 },
  ];

  it("returns every book for an empty query", () => {
    expect(filterBooks(books, "")).toEqual(books);
    expect(filterBooks(books, "   ")).toEqual(books);
  });

  it("matches the title ignoring case and diacritics", () => {
    expect(filterBooks(books, "ANOS")).toEqual([books[0]]);
    expect(filterBooks(books, "rayuela")).toEqual([books[1]]);
  });

  it("matches the author ignoring case and diacritics", () => {
    expect(filterBooks(books, "garcia")).toEqual([books[0]]);
    expect(filterBooks(books, "CORTÁZAR")).toEqual([books[1]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterBooks(books, "tolkien")).toEqual([]);
  });

  it("keeps the incoming order", () => {
    expect(filterBooks([books[1], books[0]], "a")).toEqual([books[1], books[0]]);
  });
});

function tag(id: number, name: string): Tag {
  return { id, name };
}

describe("withTag", () => {
  it("appends a tag keeping creation order", () => {
    expect(withTag([tag(1, "writing")], tag(2, "habits"))).toEqual([
      tag(1, "writing"),
      tag(2, "habits"),
    ]);
  });

  it("ignores a name that already exists ignoring case", () => {
    const tags = [tag(1, "Writing")];
    expect(withTag(tags, tag(2, "writing"))).toEqual(tags);
  });

  it("ignores a duplicate id with a different name", () => {
    const tags = [tag(1, "writing")];
    expect(withTag(tags, tag(1, "otra"))).toEqual(tags);
  });
});

describe("withoutTag", () => {
  it("removes only the requested tag", () => {
    expect(withoutTag([tag(1, "writing"), tag(2, "habits")], 1)).toEqual([tag(2, "habits")]);
  });

  it("keeps the list unchanged for an unknown id", () => {
    const tags = [tag(1, "writing")];
    expect(withoutTag(tags, 99)).toEqual(tags);
  });
});

describe("tagOverflow", () => {
  it("shows every chip when they fit", () => {
    const tags = [tag(1, "a"), tag(2, "b"), tag(3, "c")];
    expect(tagOverflow(tags)).toEqual({ visible: tags, hidden: 0 });
  });

  it("keeps three visible and counts the rest", () => {
    const tags = [tag(1, "a"), tag(2, "b"), tag(3, "c"), tag(4, "d"), tag(5, "e")];
    expect(tagOverflow(tags)).toEqual({
      visible: [tag(1, "a"), tag(2, "b"), tag(3, "c")],
      hidden: 2,
    });
  });

  it("honours a custom limit", () => {
    const tags = [tag(1, "a"), tag(2, "b")];
    expect(tagOverflow(tags, 1)).toEqual({ visible: [tag(1, "a")], hidden: 1 });
  });
});

describe("withoutTagId", () => {
  it("drops only the requested id", () => {
    expect(withoutTagId([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("keeps the list unchanged for an unknown id", () => {
    expect(withoutTagId([1], 99)).toEqual([1]);
  });
});
