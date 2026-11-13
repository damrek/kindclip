import { describe, expect, it } from "vitest";
import { FilterState } from "./filters.svelte";

function make(resets = 0, saved: string[] = []) {
  const state = new FilterState({
    resetPage: () => {
      resets += 1;
    },
    persist: (value) => {
      saved.push(JSON.stringify(value));
    },
  });
  return { state, resets: () => resets, saved };
}

describe("FilterState", () => {
  it("starts on the empty filter and reports not ready", () => {
    const { state } = make();
    expect(state.values.query).toBe("");
    expect(state.values.kinds).toEqual([]);
    expect(state.ready).toBe(false);
  });

  it("toggles kinds, authors and tags in place and resets the page", () => {
    const { state, resets } = make();

    state.toggleKind("note");
    state.toggleAuthor("A");
    state.toggleTag(4);
    state.toggleTag(4);

    expect(state.values.kinds).toEqual(["note"]);
    expect(state.values.authors).toEqual(["A"]);
    expect(state.values.tagIds).toEqual([]);
    expect(resets()).toBe(4);
    expect(state.filter.kinds).toEqual(["note"]);
  });

  it("accepts only a known sort key and direction", () => {
    const { state } = make();

    state.setSort("page:desc");
    expect(state.sort).toEqual({ key: "page", dir: "desc" });

    state.setSort("nope:desc");
    state.setSort("page:sideways");
    expect(state.sort).toEqual({ key: "page", dir: "desc" });
  });

  it("clears every field and returns to the first page", () => {
    const { state, resets } = make();
    state.toggleKind("highlight");
    state.values.query = "aurora";
    state.selectBook(3);

    state.clear();

    expect(state.values).toEqual({
      query: "",
      debouncedQuery: "",
      bookId: null,
      kinds: [],
      favoritesOnly: false,
      editedOnly: false,
      authors: [],
      tagIds: [],
      pageSize: 20,
      bookSortBy: "title",
      bookSortDir: "asc",
      sortBy: "date",
      sortDir: "desc",
    });
    expect(resets()).toBe(3);
  });

  it("applies a hydrated filter and starts saving", () => {
    const { state, saved } = make();
    state.save();
    expect(saved).toEqual([]);

    state.hydrate({ ...state.values, query: "aurora", kinds: ["note"] });
    state.save();

    expect(state.values.query).toBe("aurora");
    expect(state.ready).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('"kinds":["note"]');
  });

  it("debounces the query into the list filter", async () => {
    const { state, resets } = make();

    state.scheduleQuery("aurora");
    state.scheduleQuery("aurora borealis");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(state.values.debouncedQuery).toBe("aurora borealis");
    expect(state.filter.query).toBe("aurora borealis");
    expect(resets()).toBe(1);
  });

  it("resets the page for a new page size but not for a book sort", () => {
    const { state, resets } = make();

    state.setPageSize(50);
    state.setBookSortBy("author");
    state.toggleBookSortDir();

    expect(state.values.pageSize).toBe(50);
    expect(state.values.bookSortBy).toBe("author");
    expect(state.values.bookSortDir).toBe("desc");
    expect(resets()).toBe(1);
  });
});
