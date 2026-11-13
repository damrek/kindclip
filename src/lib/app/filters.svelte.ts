/** Filter state in one object plus the transitions that touch it.
 *
 * Every transition that changes which rows match resets the page; the sort and
 * the sidebar selection keep it. Persistence is a debounced callback supplied
 * by the shell, and stays silent until the stored filter has been applied. */
import {
  clippingSort,
  emptyFilters,
  toFilter,
  toStored,
  toggleValue,
  type FilterValues,
} from "../filters";
import type { BookSortKey, ClippingSort } from "../sorting";
import type { StoredFilterState } from "../db";
import type { ClippingFilter, ClippingKind } from "../types";

export interface FilterStateDeps {
  /** Return the list to its first page. */
  resetPage: () => void;
  /** Debounced write of the persisted shape. */
  persist: (state: StoredFilterState) => void;
}

export class FilterState {
  values = $state<FilterValues>(emptyFilters());
  #ready = false;
  #queryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: FilterStateDeps) {}

  /** Query the list loads with, rebuilt when any field changes. */
  get filter(): ClippingFilter {
    return toFilter(this.values);
  }

  get sort(): ClippingSort {
    return clippingSort(this.values);
  }

  get ready(): boolean {
    return this.#ready;
  }

  /** Apply the stored filter and let the shell start loading and saving. */
  hydrate(stored: FilterValues | null): void {
    if (stored !== null) {
      Object.assign(this.values, stored);
      this.deps.resetPage();
    }
    this.#ready = true;
  }

  replace(next: FilterValues): void {
    Object.assign(this.values, next);
    this.deps.resetPage();
  }

  /** Persist the current state; a no-op until hydration finished. */
  save(): void {
    if (this.#ready) {
      this.deps.persist(toStored(this.values));
    }
  }

  /** The query input writes the text; the list follows after a short pause. */
  scheduleQuery(value: string): void {
    if (this.#queryTimer !== null) {
      clearTimeout(this.#queryTimer);
    }
    this.#queryTimer = setTimeout(() => {
      this.#queryTimer = null;
      this.values.debouncedQuery = value;
      this.deps.resetPage();
    }, 250);
  }

  toggleKind(next: ClippingKind): void {
    this.values.kinds = toggleValue(this.values.kinds, next);
    this.deps.resetPage();
  }

  toggleFavoritesOnly(): void {
    this.values.favoritesOnly = !this.values.favoritesOnly;
    this.deps.resetPage();
  }

  toggleEditedOnly(): void {
    this.values.editedOnly = !this.values.editedOnly;
    this.deps.resetPage();
  }

  /** Toggle one author in the OR filter (S4); the list reloads from `filter`. */
  toggleAuthor(key: string): void {
    this.values.authors = toggleValue(this.values.authors, key);
    this.deps.resetPage();
  }

  /** Toggle one tag in the AND filter (S4); the list reloads from `filter`. */
  toggleTag(id: number): void {
    this.values.tagIds = toggleValue(this.values.tagIds, id);
    this.deps.resetPage();
  }

  /** Value shape of the sort select: `<key>:<dir>` (e.g. `page:asc`). */
  setSort(value: string): void {
    const [key, dir] = value.split(":");
    if (key !== "date" && key !== "title" && key !== "page") return;
    if (dir !== "asc" && dir !== "desc") return;
    this.values.sortBy = key;
    this.values.sortDir = dir;
    this.deps.resetPage();
  }

  selectBook(id: number | null): void {
    this.values.bookId = id;
    this.deps.resetPage();
  }

  setBookSortBy(key: BookSortKey): void {
    this.values.bookSortBy = key;
  }

  toggleBookSortDir(): void {
    this.values.bookSortDir = this.values.bookSortDir === "asc" ? "desc" : "asc";
  }

  setPageSize(size: number): void {
    this.values.pageSize = size;
    this.deps.resetPage();
  }

  clear(): void {
    Object.assign(this.values, emptyFilters());
    this.deps.resetPage();
  }
}
