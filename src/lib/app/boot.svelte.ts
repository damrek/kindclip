/** Startup orchestration: hydrate preferences and the stored filter, keep the
 * list in sync with the filter and pagination, prune dead authors, run the
 * daily snapshot and clear a selection that a reload dropped.
 *
 * The module owns the filter state because every effect here reacts to it; the
 * shell creates it once and reads `boot.filters` everywhere else. */
import { fromStored, keepKnownTags, toStored } from "../filters";
import {
  loadFilterState,
  listTags,
  SETTINGS_KEYS,
  type DbPort,
  type StoredFilterState,
  type TagCount,
} from "../db";
import { debounce, pruneAuthors } from "../library";
import { logger } from "../log";
import type { BookShelf, ClippingList } from "./catalog.svelte";
import { FilterState } from "./filters.svelte";
import type { Overlays } from "./overlays.svelte";
import type { Preferences } from "./preferences.svelte";
import type { SnapshotState } from "./snapshot.svelte";

export interface ShellBootDeps {
  prefs: Preferences;
  list: ClippingList;
  shelf: BookShelf;
  overlays: Overlays;
  snapshot: SnapshotState;
  getPort: () => Promise<DbPort>;
  setTags: (tags: TagCount[]) => void;
  autoBackupEnabled: () => boolean;
  /** Return the list to its first page when a filter transition asks for it. */
  resetPage: () => void;
}

export class ShellBoot {
  /** Stored filter (or defaults) applied: loading and saving may start. */
  ready = $state(false);
  readonly filters: FilterState;
  #autoBackupStarted = false;
  #saveFilters: (state: StoredFilterState) => void;

  constructor(private readonly deps: ShellBootDeps) {
    this.filters = new FilterState({
      resetPage: deps.resetPage,
      persist: (state) => this.#saveFilters(state),
    });
    this.#saveFilters = debounce((state) => {
      void this.#persist(state);
    }, 500);
  }

  /** Reload the shelf; a persisted book that no longer exists falls back to all. */
  async loadBooks(): Promise<void> {
    const failure = await this.deps.shelf.reload();
    if (failure !== null) {
      this.deps.list.error = failure;
      return;
    }
    const bookId = this.filters.values.bookId;
    if (bookId !== null && !this.deps.shelf.has(bookId)) {
      // Persisted book gone (fresh DB, re-import, …): fall back to all.
      this.filters.values.bookId = null;
      this.deps.list.resetPage();
    }
  }

  /** Once on startup: DB is the source of truth, caches seed it on first run. */
  async hydrate(): Promise<void> {
    try {
      await this.deps.prefs.hydrate();
      const port = await this.deps.getPort();
      const [stored, tags] = await Promise.all([loadFilterState(port), listTags(port)]);
      this.deps.setTags(tags);
      if (stored !== null) {
        const restored = fromStored(stored);
        // Drop ids whose tag is gone (same guard as the book id).
        restored.tagIds = keepKnownTags(
          restored.tagIds,
          tags.map((tag) => tag.id),
        );
        this.filters.hydrate(restored);
      } else {
        this.filters.hydrate(null);
        await this.#persist(toStored(this.filters.values));
      }
    } catch (error) {
      // Non-fatal: the app works with defaults and in-memory filters.
      logger.error("preferences-load", error);
    } finally {
      // The stored filter (or the defaults) is in place: the list may load
      // and the filter state may be saved. Without this gate the first load
      // runs with the empty default filter, so a list saved with
      // kinds = [note, highlight] briefly shows every kind and a slow DB
      // start can even persist the defaults back over the stored filter.
      this.ready = true;
    }
  }

  /** Register the startup effects; call during component initialisation. */
  mount(): void {
    const deps = this.deps;
    $effect(() => {
      this.filters.scheduleQuery(this.filters.values.query);
    });
    $effect(() => {
      if (!this.ready) return;
      void deps.list.reload(
        this.filters.filter,
        this.filters.values.pageSize,
        this.filters.sort,
      );
    });
    $effect(() => {
      void this.loadBooks();
    });
    $effect(() => {
      void this.hydrate();
    });
    // One automatic snapshot per launch, after the first page is on screen:
    // the VACUUM runs in the background and never delays first paint.
    $effect(() => {
      if (!this.ready || deps.list.loading || this.#autoBackupStarted) return;
      this.#autoBackupStarted = true;
      if (deps.autoBackupEnabled()) {
        void deps.snapshot.autoBackup();
      }
    });
    // Gated until the stored filter is applied, so the defaults are never
    // written over a filter the user already saved.
    $effect(() => {
      if (this.ready) this.filters.save();
    });
    // A renamed or deleted author must not keep hiding the library. Wait for
    // the stored filter and the first successful book load, so neither the
    // empty default nor a cold-start race can silently clear the selection.
    $effect(() => {
      if (!this.ready || !deps.shelf.loaded) return;
      const next = pruneAuthors(this.filters.values.authors, deps.shelf.books);
      if (next !== this.filters.values.authors) {
        this.filters.values.authors = next;
        deps.list.page = 1;
      }
    });
    $effect(() => {
      document.documentElement.lang = deps.prefs.locale;
    });
    $effect(() => {
      deps.prefs.applyCurrentFont();
    });
    $effect(() => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = (): void => deps.prefs.applyCurrentTheme();
      apply();
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    });
    /** A reload that drops the selected row (page, filter, delete) clears it. */
    $effect(() => {
      const selected = deps.overlays.selectedId;
      if (selected === null) return;
      if (
        deps.list.result === null ||
        !deps.list.result.items.some((item) => item.id === selected)
      ) {
        deps.overlays.selectedId = null;
      }
    });
  }

  async #persist(state: StoredFilterState): Promise<void> {
    await this.deps.prefs.persistSetting(SETTINGS_KEYS.filter, JSON.stringify(state));
  }
}
