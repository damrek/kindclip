/** Read models the template renders: library aggregates, author groups, the
 * export tooltip and every active-filter chip.
 *
 * Plain getters over the modules' state, so the shell only wires the sources
 * and the template reads one object. */
import type { TagCount } from "../db";
import type { FilterValues } from "../filters";
import type { Translate } from "../format";
import { groupBooksByAuthor, totalClippings } from "../library";
import { sortBooks } from "../sorting";
import type { Book, ClippingKind } from "../types";

export interface ActiveFilterChip {
  key: string;
  label: string;
  remove: () => void;
}

export interface ViewModelDeps {
  books: () => Book[];
  tags: () => TagCount[];
  values: () => FilterValues;
  /** Rows the current filter matched, for the export tooltip. */
  total: () => number;
  t: Translate;
  toggleKind: (kind: ClippingKind) => void;
  toggleFavorites: () => void;
  toggleEdited: () => void;
  toggleAuthor: (key: string) => void;
  toggleTag: (id: number) => void;
}

export function createViewModel(deps: ViewModelDeps) {
  function selectedAuthors(): Array<ReturnType<typeof groupBooksByAuthor>[number]> {
    const groups = groupBooksByAuthor(model.sortedBooks);
    return deps.values().authors.flatMap((key) => {
      const group = groups.find((item) => item.key === key);
      return group ? [group] : [];
    });
  }

  function selectedTags(): TagCount[] {
    return deps.values().tagIds.flatMap((id) => {
      const tag = deps.tags().find((item) => item.id === id);
      return tag ? [tag] : [];
    });
  }

  const model = {
    get hasLibrary(): boolean {
      return deps.books().length > 0;
    },
    get libraryTotal(): number {
      return totalClippings(deps.books());
    },
    get sortedBooks(): Book[] {
      return sortBooks(deps.books(), deps.values().bookSortBy, deps.values().bookSortDir);
    },
    /** Author groups shared by the Filters menu, chips and the sidebar. */
    get authorGroups(): ReturnType<typeof groupBooksByAuthor> {
      return groupBooksByAuthor(model.sortedBooks);
    },
    get hasActiveFilters(): boolean {
      const values = deps.values();
      return (
        values.debouncedQuery.trim() !== "" ||
        values.bookId !== null ||
        values.authors.length > 0 ||
        values.kinds.length > 0 ||
        values.favoritesOnly ||
        values.editedOnly ||
        values.tagIds.length > 0
      );
    },
    /** Dialog scope: selected book title, else which view is being exported. */
    get exportScope(): string {
      return (
        deps.books().find((book) => book.id === deps.values().bookId)?.title ??
        (model.hasActiveFilters ? deps.t("export.scopeFiltered") : deps.t("export.scopeAll"))
      );
    },
    /** Tooltip for the toolbar export button: what the next export holds. */
    get exportSummary(): string {
      return deps.t("export.summary", { count: deps.total(), scope: model.exportScope });
    },
    get selectedAuthors() {
      return selectedAuthors();
    },
    get selectedTags(): TagCount[] {
      return selectedTags();
    },
    /** Filter checklist: orphans stay hidden unless already selected (S5). */
    get filterTags(): TagCount[] {
      const selected = deps.values().tagIds;
      return deps.tags().filter((tag) => tag.clipping_count > 0 || selected.includes(tag.id));
    },
    /** Every active filter is visible and removable in the chip row. */
    get activeChips(): ActiveFilterChip[] {
      const values = deps.values();
      const chips: ActiveFilterChip[] = [];
      for (const kind of values.kinds) {
        chips.push({
          key: `kind:${kind}`,
          label: deps.t(`kind.${kind}`),
          remove: () => deps.toggleKind(kind),
        });
      }
      if (values.favoritesOnly) {
        chips.push({ key: "favorites", label: deps.t("fav.toggle"), remove: deps.toggleFavorites });
      }
      if (values.editedOnly) {
        chips.push({ key: "edited", label: deps.t("edit.toggle"), remove: deps.toggleEdited });
      }
      for (const group of model.selectedAuthors) {
        chips.push({
          key: `author:${group.key}`,
          label: group.name ?? deps.t("filters.unknownAuthor"),
          remove: () => deps.toggleAuthor(group.key),
        });
      }
      for (const tag of model.selectedTags) {
        chips.push({
          key: `tag:${tag.id}`,
          label: `#${tag.name}`,
          remove: () => deps.toggleTag(tag.id),
        });
      }
      return chips;
    },
  };
  return model;
}

export type ViewModel = ReturnType<typeof createViewModel>;
