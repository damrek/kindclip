import { describe, expect, it } from "vitest";
import {
  clippingSort,
  emptyFilters,
  fromStored,
  keepKnownTags,
  toFilter,
  toStored,
  toggleValue,
} from "./filters";
import type { StoredFilterState } from "./db";

const stored = (overrides: Partial<StoredFilterState> = {}): StoredFilterState => ({
  query: "",
  bookId: null,
  kinds: [],
  favoritesOnly: false,
  editedOnly: false,
  tagIds: [],
  pageSize: 20,
  bookSortBy: "title",
  bookSortDir: "asc",
  sortBy: "date",
  sortDir: "desc",
  ...overrides,
});

describe("emptyFilters", () => {
  it("starts unfiltered with the historical sort", () => {
    const values = emptyFilters();
    expect(values.query).toBe("");
    expect(values.kinds).toEqual([]);
    expect(values.authors).toEqual([]);
    expect(values.tagIds).toEqual([]);
    expect(values.sortBy).toBe("date");
    expect(values.sortDir).toBe("desc");
    expect(values.pageSize).toBe(20);
  });
});

describe("toFilter", () => {
  it("uses the debounced query, not the field text", () => {
    const values = { ...emptyFilters(), query: "typing", debouncedQuery: "typed" };
    expect(toFilter(values).query).toBe("typed");
  });

  it("copies the arrays so a caller cannot mutate the live filter", () => {
    const values = { ...emptyFilters(), kinds: ["note" as const], tagIds: [3] };
    const filter = toFilter(values);
    filter.kinds.push("highlight");
    filter.tagIds.push(9);
    expect(values.kinds).toEqual(["note"]);
    expect(values.tagIds).toEqual([3]);
  });
});

describe("toStored / fromStored", () => {
  it("round-trips every field", () => {
    const values = {
      ...emptyFilters(),
      query: "aurora",
      debouncedQuery: "aurora",
      bookId: 4,
      authors: ["marcus aurelius"],
      kinds: ["note" as const],
      favoritesOnly: true,
      editedOnly: true,
      tagIds: [1, 2],
      pageSize: 50,
      bookSortBy: "author" as const,
      bookSortDir: "desc" as const,
      sortBy: "page" as const,
      sortDir: "asc" as const,
    };
    const restored = fromStored(toStored(values));
    expect(restored).toEqual(values);
  });

  it("falls back to defaults for a payload written before newer fields", () => {
    const legacy = stored({ query: "old", kinds: ["highlight"] });
    delete (legacy as Partial<StoredFilterState>).editedOnly;
    delete legacy.tagIds;
    delete legacy.authors;
    delete legacy.bookSortBy;
    delete legacy.bookSortDir;
    delete legacy.sortBy;
    delete legacy.sortDir;

    const restored = fromStored(legacy);
    expect(restored.query).toBe("old");
    expect(restored.editedOnly).toBe(false);
    expect(restored.tagIds).toEqual([]);
    expect(restored.authors).toEqual([]);
    expect(restored.bookSortBy).toBe("title");
    expect(restored.sortBy).toBe("date");
    expect(restored.sortDir).toBe("desc");
  });
});

describe("clippingSort", () => {
  it("mirrors the selected keys", () => {
    expect(clippingSort({ ...emptyFilters(), sortBy: "title", sortDir: "asc" })).toEqual({
      key: "title",
      dir: "asc",
    });
  });
});

describe("keepKnownTags", () => {
  it("drops ids whose tag no longer exists", () => {
    expect(keepKnownTags([1, 2, 3], [1, 3])).toEqual([1, 3]);
  });
});

describe("toggleValue", () => {
  it("adds a missing value and removes an existing one", () => {
    expect(toggleValue([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleValue([1, 2], 2)).toEqual([1]);
  });
});
