import { describe, expect, it, vi } from "vitest";
import { createViewModel, type ViewModelDeps } from "./viewModel";
import { emptyFilters } from "../filters";
import type { TagCount } from "../db";
import type { Book } from "../types";

function book(id: number, title: string, author: string | null, count = 1): Book {
  return { id, title, author, clipping_count: count };
}

function tag(id: number, name: string, count = 1): TagCount {
  return { id, name, clipping_count: count };
}

function make(overrides: Partial<ViewModelDeps> = {}) {
  const values = emptyFilters();
  const deps: ViewModelDeps = {
    books: () => [book(1, "Zeta", "Ana"), book(2, "Alfa", "Bob")],
    tags: () => [tag(1, "one"), tag(2, "orphan", 0)],
    values: () => values,
    total: () => 7,
    t: (key, params) => (params === undefined ? key : `${key}:${String(params.count)}`),
    toggleKind: vi.fn(),
    toggleFavorites: vi.fn(),
    toggleEdited: vi.fn(),
    toggleAuthor: vi.fn(),
    toggleTag: vi.fn(),
    ...overrides,
  };
  return { model: createViewModel(deps), values, deps };
}

describe("ViewModel", () => {
  it("summarizes the library", () => {
    const { model } = make();
    expect(model.hasLibrary).toBe(true);
    expect(model.libraryTotal).toBe(2);
  });

  it("sorts books by the current sidebar sort", () => {
    const { model, values } = make();
    expect(model.sortedBooks.map((item) => item.title)).toEqual(["Alfa", "Zeta"]);

    values.bookSortDir = "desc";
    expect(model.sortedBooks.map((item) => item.title)).toEqual(["Zeta", "Alfa"]);
  });

  it("groups the sorted books by author", () => {
    const { model } = make();
    expect(model.authorGroups.map((group) => group.name)).toEqual(["Ana", "Bob"]);
  });

  it("reports an active filter from any field", () => {
    const { model, values } = make();
    expect(model.hasActiveFilters).toBe(false);

    values.debouncedQuery = "aurora";
    expect(model.hasActiveFilters).toBe(true);
  });

  it("labels the export scope and count", () => {
    const { model, values } = make();
    expect(model.exportScope).toBe("export.scopeAll");
    expect(model.exportSummary).toBe("export.summary:7");

    values.bookId = 2;
    expect(model.exportScope).toBe("Alfa");
    values.bookId = null;
    values.editedOnly = true;
    expect(model.exportScope).toBe("export.scopeFiltered");
  });

  it("resolves selected authors and tags in selection order", () => {
    const { model, values } = make();
    values.authors = ["ana", "bob"];
    values.tagIds = [1];

    expect(model.selectedAuthors.map((group) => group.name)).toEqual(["Ana", "Bob"]);
    expect(model.selectedTags.map((item) => item.name)).toEqual(["one"]);
  });

  it("hides orphan tags unless they are selected", () => {
    const { model, values } = make();
    expect(model.filterTags.map((item) => item.name)).toEqual(["one"]);

    values.tagIds = [2];
    expect(model.filterTags.map((item) => item.name)).toEqual(["one", "orphan"]);
  });

  it("builds removable chips for every active filter", () => {
    const { model, values, deps } = make();
    values.kinds = ["note"];
    values.favoritesOnly = true;
    values.editedOnly = true;
    values.authors = ["ana"];
    values.tagIds = [1];

    expect(model.activeChips.map((chip) => chip.key)).toEqual([
      "kind:note",
      "favorites",
      "edited",
      "author:ana",
      "tag:1",
    ]);
    expect(model.activeChips[0].label).toBe("kind.note");
    expect(model.activeChips[3].label).toBe("Ana");

    model.activeChips[0].remove();
    model.activeChips[3].remove();
    model.activeChips[4].remove();
    expect(deps.toggleKind).toHaveBeenCalledWith("note");
    expect(deps.toggleAuthor).toHaveBeenCalledWith("ana");
    expect(deps.toggleTag).toHaveBeenCalledWith(1);
  });
});
