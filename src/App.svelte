<script lang="ts">
  import BookSidebar from "./components/BookSidebar.svelte";
  import ClippingCard from "./components/ClippingCard.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import FilterMenu from "./components/FilterMenu.svelte";
  import Icon from "./components/Icon.svelte";
  import LibraryDialog from "./components/LibraryDialog.svelte";
  import Pagination from "./components/Pagination.svelte";
  import PreferencesDialog from "./components/PreferencesDialog.svelte";
  import ReadingView from "./components/ReadingView.svelte";
  import RestoreDialog from "./components/RestoreDialog.svelte";
  import ShortcutsDialog from "./components/ShortcutsDialog.svelte";
  import StatsDialog from "./components/StatsDialog.svelte";
  import appIcon from "./assets/icon.png";
  import { invoke } from "@tauri-apps/api/core";
  import { confirm, open } from "@tauri-apps/plugin-dialog";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { setContext, tick } from "svelte";
  import { I18N_CONTEXT_KEY, countText, type I18nContext } from "./lib/i18n";
  import { applyTheme, resolveTheme, systemPrefersDark } from "./lib/theme";
  import { applyFontScale } from "./lib/font";
  import {
    readSidebarOpen,
    readSidebarView,
    saveSidebarOpen,
    saveSidebarView,
    type SidebarView,
  } from "./lib/sidebar";
  import {
    closeDb,
    exportClippings,
    getDb,
    getSetting,
    listBooks,
    listClippings,
    listTags,
    loadFilterState,
    setSetting,
    SETTINGS_KEYS,
    type DbPort,
    type ImportedFile,
    type StoredFilterState,
    type TagCount,
  } from "./lib/db";
  import { runImportFlow, tauriImportDeps } from "./lib/importer";
  import { describeError, logger } from "./lib/log";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
  import {
                  type ExportFormat,
  } from "./lib/exporter";
  import {
    debounce,
    groupBooksByAuthor,
    totalClippings,
    pruneAuthors,
    withoutTagId,
  } from "./lib/library";
  import {
    clippingSort as clippingSortOf,
    emptyFilters,
    fromStored,
    keepKnownTags,
    toFilter,
    toStored,
    toggleValue,
    type FilterValues,
  } from "./lib/filters";
  import {
    sortBooks,
    type BookSortKey,
  } from "./lib/sorting";
  import {
    type ReadingDirection,
  } from "./lib/reading";
  import {
    isInteractiveTarget,
    isPaletteCombo,
    isTypingTarget,
    resolveShortcut,
    stepSelection,
    type SelectionDirection,
    type ShortcutAction,
  } from "./lib/shortcuts";
  import { focusOnMount, trapFocus } from "./lib/focus";
  import type { Book, ClippingKind, ClippingRow } from "./lib/types";
  import { loadReadingStats } from "./lib/stats";
  import { BookShelf, ClippingList } from "./lib/app/catalog.svelte";
  import { Preferences } from "./lib/app/preferences.svelte";
  import { ReadingState } from "./lib/app/reading.svelte";
  import { LibraryPanel } from "./lib/app/library.svelte";
  import { SnapshotState, tauriSnapshotBackend } from "./lib/app/snapshot.svelte";
  import { ImportState, type ImportRunner } from "./lib/app/import.svelte";
  import { ExportState, saveDialog } from "./lib/app/export.svelte";
  import { StatsState } from "./lib/app/stats.svelte";
  import { ClippingActions } from "./lib/app/actions.svelte";
  import { escapeLayer } from "./lib/app/overlays";

  /** Run one data-layer call with the shared connection. */
  async function withPort<T>(run: (port: DbPort) => Promise<T>): Promise<T> {
    return run(await getDb());
  }

  const list = new ClippingList(
    (filter, page, sort) => withPort((port) => listClippings(port, filter, page, sort)),
    logger.error,
  );
  const shelf = new BookShelf(
    () => withPort((port) => listBooks(port)),
    logger.error,
  );
  let allTags = $state<TagCount[]>([]);
  /** Set once the stored filter has been applied; gates load and save. */
  let prefsReady = $state(false);

  let filters = $state<FilterValues>(emptyFilters());
  let sidebarOpen = $state(readSidebarOpen());
  let sidebarView = $state(readSidebarView());
  let searchExpanded = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);

  let locatingDb = $state(false);
  let importStatus = $state<string | null>(null);
  /** Manual backup, automatic snapshot and restore live in one module. */
  let autoBackupStarted = false;
  /** Full-window reading.session session; null when closed. */
  const reading = new ReadingState(
    (filterState, page, sort) => withPort((port) => listClippings(port, filterState, page, sort)),
    logger.error,
  );
  /** Element that opened the reading.session view; focus returns to it on close. */
  let listRegion = $state<HTMLElement | null>(null);
  /** Card selected with j/k; the target of Enter, * and c. */
  let selectedId = $state<number | null>(null);
  let shortcutsOpen = $state(false);
  /** Global clipping search overlay (Ctrl/Cmd+P). */
  let paletteOpen = $state(false);
  /** Controlled so App can close one overlay per Escape. */
  let filtersOpen = $state(false);
  let prefsOpen = $state(false);
  /** Element that opened the current modal; focus returns to it on close. */
  let modalOpener: HTMLElement | null = null;
  const prefs = new Preferences({
    getSetting: (key) => withPort((port) => getSetting(port, key)),
    setSetting: (key, value) => withPort((port) => setSetting(port, key, value)),
    applyTheme: (mode, palette) =>
      applyTheme(
        document.documentElement,
        resolveTheme(mode, systemPrefersDark(), palette),
      ),
    applyFontScale: (scale) => applyFontScale(document.documentElement, scale),
    log: logger.error,
  });
  const t = prefs.t;

  const library = new LibraryPanel({
    getPort: () => getDb(),
    t,
    count: (noun, value) => countText(prefs.locale, noun, value),
    refresh: async () => {
      await loadBooks();
      await list.reload(toFilter(filters), filters.pageSize, clippingSortOf(filters));
      const port = await getDb();
      allTags = await listTags(port);
    },
    onTagRemoved: (tagId) => {
      filters.tagIds = withoutTagId(filters.tagIds, tagId);
    },
    log: logger.error,
  });
  const snapshot = new SnapshotState({
    getPort: () => getDb(),
    closePort: async () => {
      await closeDb();
    },
    t,
    backend: tauriSnapshotBackend(),
    refresh: () => refreshAfterLibraryChange(),
    log: logger,
  });

  /** Live system preference: the theme follows macOS while the choice is "system". */
  $effect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => prefs.applyCurrentTheme();
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  });

  $effect(() => {
    prefs.applyCurrentFont();
  });

  $effect(() => {
    document.documentElement.lang = prefs.locale;
  });

  setContext<I18nContext>(I18N_CONTEXT_KEY, {
    get locale() {
      return prefs.locale;
    },
    t,
    setLocale: (next) => prefs.setLocale(next),
  });

  const filter = $derived(toFilter(filters));
  const clippingSort = $derived(clippingSortOf(filters));

  const imports = new ImportState({
    t,
    count: (noun, value) => countText(prefs.locale, noun, value),
    makeDeps: tauriImportDeps,
    refresh: async () => {
      list.page = 1;
      await loadBooks();
      list.resetPage();
      await list.reload(toFilter(filters), filters.pageSize, clippingSortOf(filters));
    },
    log: logger,
  });
  const exports = new ExportState({
    loadRows: () => withPort((port) => exportClippings(port, filter)),
    t,
    locale: () => prefs.locale,
    count: (noun, value) => countText(prefs.locale, noun, value),
    bookId: () => filters.bookId,
    bookTitle: (bookId) => shelf.books.find((book) => book.id === bookId)?.title ?? null,
    canExport: () => list.result !== null && list.result.total > 0,
    now: () => new Date(),
    backend: {
      pickFolder: async (title) => {
        const picked = await open({ directory: true, multiple: false, title });
        return typeof picked === "string" ? picked : null;
      },
      checkTargets: (dir, names) => invoke<string[]>("check_export_targets", { dir, names }),
      confirmReplace: (message, title) => confirm(message, { title, kind: "warning" }),
      writeFiles: (dir, files) => invoke<number>("write_export_files", { dir, files }),
      defaultPath: async (fileName) => {
        try {
          return await invoke<string>("export_default_path", { suggestedFileName: fileName });
        } catch {
          // Non-fatal: the bare file name is a valid default path.
          return fileName;
        }
      },
      saveFile: saveDialog,
      writeFile: (path, contents) => invoke("write_export_file", { path, contents }),
    },
    log: logger,
  });

  const stats = new StatsState({
    getPort: () => getDb(),
    load: loadReadingStats,
    t,
    log: logger,
  });
  const actions = new ClippingActions({
    getPort: () => getDb(),
    list,
    reload: () => list.reload(toFilter(filters), filters.pageSize, clippingSortOf(filters)),
    favoritesOnly: () => filters.favoritesOnly,
    editedOnly: () => filters.editedOnly,
    selectedTagIds: () => filters.tagIds,
    readingRow: () => reading.current,
    setTags: (tags) => {
      allTags = tags;
    },
  });

  /** Reading view or a modal: the shell is inert and shortcuts are off. */
  const modalOpen = $derived(
    reading.session !== null ||
      paletteOpen ||
      actions.resetTarget !== null ||
      exports.open ||
      library.open ||
      stats.open ||
      snapshot.open ||
      prefsOpen ||
      shortcutsOpen,
  );
  const pages = $derived(Math.max(1, Math.ceil((list.result?.total ?? 0) / filters.pageSize)));


  const scheduleQuery = debounce((value: string) => {
    filters.debouncedQuery = value;
    list.page = 1;
  }, 250);

  async function loadBooks(): Promise<void> {
    const failure = await shelf.reload();
    if (failure !== null) {
      list.error = failure;
      return;
    }
    if (filters.bookId !== null && !shelf.has(filters.bookId)) {
      // Persisted book gone (fresh DB, re-import, …): fall back to all.
      filters.bookId = null;
      list.resetPage();
    }
  }

  /** Once on startup: DB is the source of truth, caches seed it on first run. */
  async function loadPreferences(): Promise<void> {
    try {
      await prefs.hydrate();
      const port = await getDb();
      const [dbFilter, dbTags] = await Promise.all([loadFilterState(port), listTags(port)]);
      allTags = dbTags;
      if (dbFilter) {
        const restored = fromStored(dbFilter);
        // Drop ids whose tag is gone (same guard as the book id).
        restored.tagIds = keepKnownTags(
          restored.tagIds,
          dbTags.map((tag) => tag.id),
        );
        filters = restored;
        list.page = 1;
      } else {
        await persistFilterState(toStored(filters));
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
      prefsReady = true;
    }
  }

  async function persistFilterState(state: StoredFilterState): Promise<void> {
    await prefs.persistSetting(SETTINGS_KEYS.filter, JSON.stringify(state));
  }

  const saveFilters = debounce((state: StoredFilterState) => {
    void persistFilterState(state);
  }, 500);

  $effect(() => {
    scheduleQuery(filters.query);
  });

  // NOTE: $effect only tracks state read SYNCHRONOUSLY in its body.
  // list.reload reads page synchronously, so this effect tracks it; filter and
  // pageSize are passed in from state read in this body.
  //
  // Waiting for prefsReady keeps the first load from running with the empty
  // default filter: the stored filters.kinds must be applied first, or a list saved
  // as notes + highlights flashes every kind (bookmarks included) and a slow
  // cold start can leave that unfiltered page on screen.
  $effect(() => {
    if (!prefsReady) return;
    void list.reload(filter, filters.pageSize, clippingSort);
  });

  $effect(() => {
    void loadBooks();
  });

  $effect(() => {
    void loadPreferences();
  });

  // One automatic snapshot per launch, after the first page is on screen:
  // the VACUUM runs in the background and never delays first paint. Waiting
  // for `loading` to settle also keeps it from competing with the first list
  // filters.query for the same connection.
  $effect(() => {
    if (!prefsReady || list.loading || autoBackupStarted) return;
    autoBackupStarted = true;
    if (prefs.autoBackupEnabled) {
      void snapshot.autoBackup();
    }
  });

  // Snapshot passed synchronously (see the reload NOTE above): the debounced
  // write itself runs outside tracking, but the state snapshot is captured here.
  // Gated until the stored filter is applied, so the defaults are never written
  // over a filter the user already saved.
  $effect(() => {
    if (!prefsReady) return;
    saveFilters(toStored(filters));
  });

  // A renamed or deleted author must not keep hiding the library (S6). Wait
  // for the stored filter and the first successful book load, so neither the
  // empty default nor a cold-start race can silently clear the selection.
  $effect(() => {
    if (!prefsReady || !shelf.loaded) return;
    const next = pruneAuthors(filters.authors, shelf.books);
    if (next !== filters.authors) {
      filters.authors = next;
      list.page = 1;
    }
  });

  $effect(() => {
    document.documentElement.lang = prefs.locale;
  });

  /** A reload that drops the selected row (page, filter, delete) clears it. */
  $effect(() => {
    if (selectedId === null) return;
    if (list.result === null || !list.result.items.some((item) => item.id === selectedId)) {
      selectedId = null;
    }
  });

  function selectBook(id: number | null): void {
    filters.bookId = id;
    list.page = 1;
  }

  function setBookSortBy(key: BookSortKey): void {
    filters.bookSortBy = key;
  }

  function toggleBookSortDir(): void {
    filters.bookSortDir = filters.bookSortDir === "asc" ? "desc" : "asc";
  }

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
    saveSidebarOpen(sidebarOpen);
  }

  function setSidebarView(next: SidebarView): void {
    if (next === sidebarView) return;
    sidebarView = next;
    saveSidebarView(next);
  }

  async function openSearch(): Promise<void> {
    searchExpanded = true;
    await tick();
    searchInput?.focus();
  }

  /** Escape clears the search text first, then folds the field away. */
  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The window handler closes overlays; the field owns this Escape.
    event.preventDefault();
    event.stopPropagation();
    if (filters.query !== "") {
      filters.query = "";
      return;
    }
    searchExpanded = false;
    (event.currentTarget as HTMLInputElement).blur();
  }

  function onSearchBlur(): void {
    if (filters.query === "") searchExpanded = false;
  }

  function clearSearch(): void {
    filters.query = "";
    searchExpanded = false;
  }

  function toggleKind(next: ClippingKind): void {
    filters.kinds = toggleValue(filters.kinds, next);
    list.page = 1;
  }

  function toggleFavoritesOnly(): void {
    filters.favoritesOnly = !filters.favoritesOnly;
    list.page = 1;
  }

  function toggleEditedOnly(): void {
    filters.editedOnly = !filters.editedOnly;
    list.page = 1;
  }

  /** Toggle one author in the OR filter (S4); the list reloads from `filter`. */
  function toggleAuthor(key: string): void {
    filters.authors = toggleValue(filters.authors, key);
    list.page = 1;
  }

  /** Toggle one tag in the AND filter (S4); the list reloads from `filter`. */
  function toggleTag(id: number): void {
    filters.tagIds = toggleValue(filters.tagIds, id);
    list.page = 1;
  }

  /** Value shape of the sort select: `<key>:<dir>` (e.g. `page:asc`). */
  function setClippingSort(value: string): void {
    const [key, dir] = value.split(":");
    if (key !== "date" && key !== "title" && key !== "page") return;
    if (dir !== "asc" && dir !== "desc") return;
    filters.sortBy = key;
    filters.sortDir = dir;
    list.page = 1;
  }

  const copyContent = (id: number): Promise<void> => actions.copyContent(id);
  const copyQuote = (id: number): Promise<void> => actions.copyQuote(id);
  const copyReadingQuote = (): void => actions.copyReadingQuote();
  const toggleStar = (id: number): Promise<void> => actions.toggleStar(id);
  const addTagToClipping = (id: number, name: string): Promise<boolean> =>
    actions.addTag(id, name);
  const removeTagFromClipping = (id: number, tagId: number): Promise<boolean> =>
    actions.removeTag(id, tagId);
  const editNote = (id: number, content: string): Promise<boolean> =>
    actions.editNote(id, content);
  function changePageSize(size: number): void {
    filters.pageSize = size;
    list.page = 1;
  }

  /** Open the reset confirmation dialog for a note (rendered at app root). */
  function requestReset(id: number): void {
    rememberOpener();
    actions.requestReset(id);
  }

  function confirmResetDialog(): Promise<void> {
    return actions.confirmReset();
  }

  /** Open the full-window reading.session view on one visible row. */
  function startReading(id: number): void {
    if (!list.result) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reading.openList(
      list.result,
      id,
      { filter: list.resultFilter, sort: list.resultSort },
      opener,
    );
  }

  /** Global palette result: the matches become the reading.session window. */
  function openPaletteResult(items: ClippingRow[], id: number, query: string): void {
    const opener = modalOpener;
    paletteOpen = false;
    modalOpener = null;
    reading.openWindow(items, id, opener, query);
  }

  /** Close and leave the list on the page where reading.session stopped. */
  function closeReading(): Promise<void> {
    return reading.close(
      (target) => {
        list.page = target;
      },
      list.page,
      listRegion,
    );
  }

  /** Remember where focus was before a modal opened. A dialog opened from
   * another one keeps the original opener, so focus never lands on a panel
   * that unmounted with the chain. */
  function rememberOpener(): void {
    if (modalOpener !== null && modalOpener.isConnected) return;
    modalOpener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  /** Give focus back once the modal unmounted and the shell is not inert. */
  function restoreOpener(): void {
    const opener = modalOpener;
    modalOpener = null;
    void tick().then(() => {
      const target = opener !== null && opener.isConnected ? opener : listRegion;
      target?.focus();
    });
  }

  function openShortcuts(): void {
    if (shortcutsOpen) return;
    rememberOpener();
    shortcutsOpen = true;
  }

  function openPalette(): void {
    if (paletteOpen || modalOpen) return;
    rememberOpener();
    paletteOpen = true;
  }

  function closePalette(): void {
    if (!paletteOpen) return;
    paletteOpen = false;
    restoreOpener();
  }

  function closeShortcuts(): void {
    if (!shortcutsOpen) return;
    shortcutsOpen = false;
    restoreOpener();
  }

  function closeReset(): void {
    if (actions.closeReset()) {
      restoreOpener();
    }
  }

  /** S1: whole-library aggregates, fetched fresh each time the dialog opens. */
  async function openStats(): Promise<void> {
    if (stats.open) return;
    rememberOpener();
    await stats.show();
  }

  function closeStats(): void {
    if (stats.close()) {
      restoreOpener();
    }
  }

  function openPreferences(): void {
    if (prefsOpen) return;
    rememberOpener();
    prefsOpen = true;
  }

  /** `restoreFocus: false` when another dialog takes over the screen. */
  function closePreferences(restoreFocus = true): void {
    if (!prefsOpen) return;
    prefsOpen = false;
    if (restoreFocus) restoreOpener();
  }

  /** Settings actions that own the screen: the dialog steps aside first. */
  function handOffFromPreferences(action: () => void): void {
    closePreferences(false);
    action();
  }

  /** No dialog follows the reveal, so the gear takes focus back. */
  function openDbFromPreferences(): void {
    closePreferences();
    onOpenDbLocation();
  }

  /** Focus a visible card so it becomes the j/k, Enter, * and c target. */
  async function moveSelection(direction: SelectionDirection): Promise<void> {
    const next = stepSelection(list.result?.items ?? [], selectedId, direction);
    if (next === null) return;
    selectedId = next;
    await tick();
    listRegion
      ?.querySelector<HTMLElement>(`[data-clipping-id="${next}"]`)
      ?.focus();
  }

  function stepPage(direction: "next" | "prev"): void {
    const next = direction === "next" ? list.page + 1 : list.page - 1;
    if (next < 1 || next > pages) return;
    list.page = next;
    selectedId = null;
  }

  function runShortcut(action: ShortcutAction): void {
    switch (action) {
      case "focus-search":
        void openSearch();
        break;
      case "open-palette":
        openPalette();
        break;
      case "open-help":
        openShortcuts();
        break;
      case "toggle-sidebar":
        toggleSidebar();
        break;
      case "open-filters":
        filtersOpen = true;
        break;
      case "open-preferences":
        openPreferences();
        break;
      case "next-clipping":
        void moveSelection("next");
        break;
      case "prev-clipping":
        void moveSelection("prev");
        break;
      case "open-clipping":
        if (selectedId !== null) startReading(selectedId);
        break;
      case "toggle-favorite":
        if (selectedId !== null) void toggleStar(selectedId);
        break;
      case "copy-clipping":
        if (selectedId !== null) void copyContent(selectedId);
        break;
      case "copy-quote":
        if (selectedId !== null) void copyQuote(selectedId);
        break;
      case "next-page":
        stepPage("next");
        break;
      case "prev-page":
        stepPage("prev");
        break;
    }
  }

  /** One window listener: Escape closes one layer, everything else resolves. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;

    if (event.key === "Escape") {
      const layer = escapeLayer({
        reading: reading.session !== null,
        palette: paletteOpen,
        shortcuts: shortcutsOpen,
        reset: actions.resetTarget !== null,
        exportOpen: exports.open,
        library: library.open,
        stats: stats.open,
        restore: snapshot.open,
        preferences: prefsOpen,
        filters: filtersOpen,
        query: filters.query,
        searchExpanded,
        selection: selectedId !== null,
      });
      if (layer === "none") return;
      // The reading view owns its own Escape and arrows.
      if (layer === "reading") return;
      event.preventDefault();
      switch (layer) {
        case "palette":
          closePalette();
          return;
        case "shortcuts":
          closeShortcuts();
          return;
        case "reset":
          closeReset();
          return;
        case "export":
          if (!exports.task.busy) closeExport();
          return;
        case "library":
          if (!library.busy) closeLibrary();
          return;
        case "stats":
          closeStats();
          return;
        case "restore":
          if (!snapshot.busy) closeRestore();
          return;
        case "preferences":
          closePreferences();
          return;
        case "filters":
          filtersOpen = false;
          return;
        case "query":
          filters.query = "";
          return;
        case "search":
          searchExpanded = false;
          return;
        case "selection":
          selectedId = null;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          return;
      }
    }

    // ? toggles the help it opened.
    if (shortcutsOpen && event.key === "?") {
      event.preventDefault();
      closeShortcuts();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const action = resolveShortcut(event, {
      typing: isTypingTarget(target),
      interactive: isInteractiveTarget(target),
      overlay: modalOpen || filtersOpen,
      hasLibrary,
      hasResults: (list.result?.items.length ?? 0) > 0,
      hasSelection: selectedId !== null,
      canPrevPage: list.page > 1,
      canNextPage: list.page < pages,
    });
    if (action === null) {
      // The palette combo belongs to the app in every focus state, so the
      // platform print action never fires on it, even when an overlay owns
      // the keyboard and the palette itself stays closed.
      if (isPaletteCombo(event)) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    runShortcut(action);
  }

  /** Step one row; fetch the adjacent page only when the window runs out. */
  function stepReading(dir: ReadingDirection): Promise<void> {
    return reading.step(dir);
  }

  function clearFilters(): void {
    filters.query = "";
    filters.debouncedQuery = "";
    filters.favoritesOnly = false;
    filters.editedOnly = false;
    filters.authors = [];
    filters.kinds = [];
    filters.tagIds = [];
    searchExpanded = false;
    selectBook(null);
  }

  async function onImport(): Promise<void> {
    await performImport(runImportFlow);
  }

  /** S1: one import run for both the picker and a native file drop. */
  function performImport(run: ImportRunner): Promise<void> {
    return imports.run(run, (message) => {
      importStatus = message;
    });
  }

  /** S1: a native file drop imports the first `.txt` it carries. */
  function onDropPaths(paths: string[]): void {
    void imports.drop(paths, modalOpen, (message) => {
      importStatus = message;
    });
  }

  // Native drag & drop: Tauri intercepts the OS drag before the webview, so
  // the overlay is pure feedback — the paths arrive in the drop payload.
  $effect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          imports.dragActive = !modalOpen && !imports.busy;
        } else if (payload.type === "leave") {
          imports.dragActive = false;
        } else if (payload.type === "drop") {
          imports.dragActive = false;
          onDropPaths(payload.paths);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Plain browser (no Tauri bridge): the native drop is unavailable.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  /** Open the export dialog from the header (clears the previous outcome). */
  function openExport(): void {
    if (exports.openDialog()) {
      rememberOpener();
    }
  }

  function onExport(
    format: ExportFormat,
    includeOriginal: boolean,
    perBook: boolean,
  ): Promise<void> {
    return exports.run(format, includeOriginal, perBook);
  }

  function closeExport(): void {
    if (!exports.open) return;
    exports.close();
    restoreOpener();
  }

  async function onOpenDbLocation(): Promise<void> {
    if (locatingDb) return;
    locatingDb = true;
    try {
      await revealDbLocation(tauriDbLocationDeps());
    } catch (error) {
      importStatus = t("db.error", {
        message: describeError(error),
      });
      logger.error("db-location", error);
    } finally {
      locatingDb = false;
    }
  }

  function onBackup(): Promise<void> {
    return snapshot.save();
  }

  function onRestoreRequest(): void {
    rememberOpener();
    void snapshot.openDialog();
  }

  const inspectRestorePath = (path: string): Promise<void> => snapshot.inspect(path);
  const chooseRestoreFile = (): Promise<void> => snapshot.chooseFile();
  const confirmRestore = (): Promise<void> => snapshot.confirm();

  function closeRestore(): void {
    if (snapshot.close()) {
      restoreOpener();
    }
  }

  /** Reload every view the app can affect after a database swap. */
  async function refreshAfterLibraryChange(): Promise<void> {
    await loadBooks();
    await list.reload(toFilter(filters), filters.pageSize, clippingSortOf(filters));
    await library.loadFiles();
    const port = await getDb();
    allTags = await listTags(port);
  }

  async function openLibrary(): Promise<void> {
    rememberOpener();
    await library.show();
  }

  function closeLibrary(): void {
    if (!library.open) return;
    library.close();
    restoreOpener();
  }

  const libraryRename = (bookId: number, title: string, author: string) =>
    library.rename(bookId, title, author);
  const libraryMerge = (sourceId: number, targetId: number) =>
    library.merge(sourceId, targetId);
  const libraryDeleteBook = (book: Book) => library.removeBook(book);
  const libraryRemoveFile = (file: ImportedFile) => library.removeFile(file);
  const libraryRenameTag = (tagId: number, name: string) => library.renameTag(tagId, name);
  const libraryMergeTags = (sourceId: number, targetId: number) =>
    library.mergeTags(sourceId, targetId);
  const libraryDeleteTag = (tag: TagCount) => library.removeTag(tag);

  const hasLibrary = $derived(shelf.books.length > 0);
  const libraryTotal = $derived(totalClippings(shelf.books));
  const sortedBooks = $derived(sortBooks(shelf.books, filters.bookSortBy, filters.bookSortDir));
  /** Author groups shared by the Filters menu, chips and the grouped sidebar. */
  const authorGroups = $derived(groupBooksByAuthor(sortedBooks));
  const hasActiveFilters = $derived(
    filters.debouncedQuery.trim() !== "" ||
      filters.bookId !== null ||
      filters.authors.length > 0 ||
      filters.kinds.length > 0 ||
      filters.favoritesOnly ||
      filters.editedOnly ||
      filters.tagIds.length > 0,
  );
  /** Dialog scope: selected book title, else which view is being exported. */
  const exportScope = $derived(
    shelf.books.find((book) => book.id === filters.bookId)?.title ??
      (hasActiveFilters ? t("export.scopeFiltered") : t("export.scopeAll")),
  );
  /** Tooltip for the toolbar export button: what the next export would hold. */
  const exportSummary = $derived(
    t("export.summary", { count: list.result?.total ?? 0, scope: exportScope }),
  );
  /** Row shown full-window; null while the reading.session view is closed. */
  const readingClipping = $derived(reading.current);

  /** Selected filters.authors in selection order, for the removable chips under the bar. */
  const selectedAuthors = $derived(
    filters.authors.flatMap((key) => {
      const group = authorGroups.find((item) => item.key === key);
      return group ? [group] : [];
    }),
  );
  /** Selected tags in selection order, for the removable chips under the bar. */
  const selectedTags = $derived(
    filters.tagIds.flatMap((id) => {
      const tag = allTags.find((item) => item.id === id);
      return tag ? [tag] : [];
    }),
  );
  /** Filter checklist: orphans stay hidden unless already selected (S5). */
  const filterTags = $derived(
    allTags.filter((tag) => tag.clipping_count > 0 || filters.tagIds.includes(tag.id)),
  );

  interface ActiveFilterChip {
    key: string;
    label: string;
    remove: () => void;
  }

  /** Every active filter is visible and removable in the chip row, not just tags. */
  const activeChips = $derived.by((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];
    for (const kind of filters.kinds) {
      chips.push({
        key: `kind:${kind}`,
        label: t(`kind.${kind}`),
        remove: () => toggleKind(kind),
      });
    }
    if (filters.favoritesOnly) {
      chips.push({ key: "favorites", label: t("fav.toggle"), remove: toggleFavoritesOnly });
    }
    if (filters.editedOnly) {
      chips.push({ key: "edited", label: t("edit.toggle"), remove: toggleEditedOnly });
    }
    for (const group of selectedAuthors) {
      chips.push({
        key: `author:${group.key}`,
        label: group.name ?? t("filters.unknownAuthor"),
        remove: () => toggleAuthor(group.key),
      });
    }
    for (const tag of selectedTags) {
      chips.push({
        key: `tag:${tag.id}`,
        label: `#${tag.name}`,
        remove: () => toggleTag(tag.id),
      });
    }
    return chips;
  });
</script>

<div class="flex h-full flex-col" inert={modalOpen}>
  <header
    class="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2">
      {#if hasLibrary}
        <button
          type="button"
          onclick={toggleSidebar}
          aria-label={t("sidebar.toggle")}
          aria-expanded={sidebarOpen}
          aria-controls="book-sidebar"
          aria-keyshortcuts="s"
          title={t("sidebar.toggle")}
          class="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <Icon name="sidebar" />
        </button>
      {/if}
      <h1 class="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
        <img src={appIcon} alt="" width="24" height="24" class="h-6 w-6 rounded-[6px]" />
        kindclip
      </h1>
    </div>
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={openPreferences}
        title={t("prefs.open")}
        aria-label={t("prefs.open")}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+, Control+,"
        class="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <Icon name="settings" />
      </button>
    </div>
  </header>

  {#if list.error}
    <p class="border-b border-danger-border bg-danger-soft px-6 py-2 text-sm text-danger" role="alert">
      {list.error}
    </p>
  {/if}

  {#if !hasLibrary && !list.loading}
    <main class="flex flex-1 items-center justify-center px-6">
      <div class="max-w-sm text-center">
        <div
          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft-strong text-2xl"
          aria-hidden="true"
        >
          &#10077;
        </div>
        <h2 class="text-base font-medium">{t("empty.title")}</h2>
        <p class="mt-1 text-sm text-fg-muted">
          {t("empty.body")}
        </p>
        <button
          type="button"
          onclick={onImport}
          disabled={imports.busy}
          class="mt-4 rounded-full bg-inverse px-5 py-2 text-sm font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
        >
          {imports.busy ? t("header.importing") : t("empty.cta")}
        </button>
      </div>
    </main>
  {:else}
    <div class="relative flex min-h-0 flex-1">
      {#if sidebarOpen}
        <button
          type="button"
          onclick={toggleSidebar}
          aria-label={t("sidebar.toggle")}
          tabindex="-1"
          class="fixed inset-0 z-20 cursor-default bg-black/20 md:hidden"
        ></button>
      {/if}
      <aside
        id="book-sidebar"
        class="absolute inset-y-0 left-0 z-30 w-64 shrink-0 overflow-y-auto border-r border-line bg-surface p-3 shadow-xl md:static md:z-auto md:bg-transparent md:shadow-none {sidebarOpen
          ? ''
          : 'hidden'}"
      >
        <BookSidebar
          books={sortedBooks}
          groups={authorGroups}
          view={sidebarView}
          onViewChange={setSidebarView}
          selectedId={filters.bookId}
          totalCount={libraryTotal}
          onSelect={selectBook}
          sortBy={filters.bookSortBy}
          sortDir={filters.bookSortDir}
          onSortBy={setBookSortBy}
          onSortDirToggle={toggleBookSortDir}
          onImport={onImport}
          importing={imports.busy}
          onOpenLibrary={openLibrary}
          onOpenStats={openStats}
          libraryActionsDisabled={!hasLibrary}
        />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3"
        >
          <div class="flex min-w-0 flex-1 items-center">
            {#if searchExpanded || filters.query !== ""}
              <div class="relative w-full max-w-sm">
                <span
                  class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle"
                  aria-hidden="true"
                >
                  <Icon name="search" class="h-4 w-4" />
                </span>
                <input
                  bind:this={searchInput}
                  type="search"
                  bind:value={filters.query}
                  onkeydown={onSearchKeydown}
                  onblur={onSearchBlur}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.placeholder")}
                  class="w-full rounded-full border border-line bg-surface-inset py-2 pr-8 pl-9 text-sm outline-none placeholder:text-fg-subtle focus:border-line-strong"
                />
                {#if filters.query !== ""}
                  <button
                    type="button"
                    onclick={clearSearch}
                    aria-label={t("search.clear")}
                    class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-2 text-fg-subtle hover:text-fg"
                  >
                    ×
                  </button>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                onclick={openSearch}
                title={t("search.open")}
                aria-label={t("search.open")}
                aria-keyshortcuts="/"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
              >
                <Icon name="search" />
              </button>
            {/if}
          </div>

          <FilterMenu
            bind:open={filtersOpen}
            authors={filters.authors}
            {authorGroups}
            kinds={filters.kinds}
            favoritesOnly={filters.favoritesOnly}
            editedOnly={filters.editedOnly}
            tagIds={filters.tagIds}
            tags={filterTags}
            onToggleAuthor={toggleAuthor}
            onToggleKind={toggleKind}
            onToggleFavorites={toggleFavoritesOnly}
            onToggleEdited={toggleEditedOnly}
            onToggleTag={toggleTag}
            onClear={clearFilters}
          />

          <div class="ml-auto flex items-center gap-2">
            <label>
              <span class="sr-only">{t("clippingSort.label")}</span>
              <select
                value={`${filters.sortBy}:${filters.sortDir}`}
                onchange={(event) => setClippingSort(event.currentTarget.value)}
                aria-label={t("clippingSort.label")}
                class="cursor-pointer rounded-full border border-line bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-line-strong"
              >
                <option value="date:desc">{t("clippingSort.dateDesc")}</option>
                <option value="date:asc">{t("clippingSort.dateAsc")}</option>
                <option value="title:asc">{t("clippingSort.titleAsc")}</option>
                <option value="title:desc">{t("clippingSort.titleDesc")}</option>
                <option value="page:asc">{t("clippingSort.pageAsc")}</option>
                <option value="page:desc">{t("clippingSort.pageDesc")}</option>
              </select>
            </label>
            <button
              type="button"
              onclick={openExport}
              disabled={!list.result || list.result.total === 0}
              title={exportSummary}
              aria-label={exportSummary}
              class="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            >
              <Icon name="export" />
            </button>
          </div>
        </div>

        {#if importStatus || exports.message}
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-6 py-2 text-sm text-fg-muted"
            role="status"
          >
            {#if importStatus}
              <p class="min-w-0 truncate">{importStatus}</p>
            {/if}
            {#if exports.message}
              <p class="min-w-0 truncate">{exports.message}</p>
            {/if}
          </div>
        {/if}

        {#if activeChips.length > 0}
          <div
            class="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2"
          >
            {#each activeChips as chip (chip.key)}
              <span
                class="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-fg-muted"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onclick={chip.remove}
                  aria-label={t("filters.remove", { name: chip.label })}
                  title={t("filters.remove", { name: chip.label })}
                  class="-mr-0.5 rounded-full px-0.5 text-sm leading-none text-fg-subtle transition hover:text-fg"
                >
                  ×
                </button>
              </span>
            {/each}
            <button
              type="button"
              onclick={clearFilters}
              class="ml-1 text-xs font-medium text-fg-muted underline-offset-2 transition hover:text-fg hover:underline"
            >
              {t("results.clear")}
            </button>
          </div>
        {/if}

        <div
          bind:this={listRegion}
          tabindex="-1"
          class="flex-1 space-y-3 overflow-y-auto px-6 py-4 {list.loading ? 'opacity-50' : ''}"
        >
          {#if list.result && list.result.items.length > 0}
            {#each list.result.items as clipping (clipping.id)}
              <ClippingCard
                {clipping}
                {allTags}
                copied={actions.copyFlash?.id === clipping.id && actions.copyFlash.kind === "content"}
                quoted={actions.copyFlash?.id === clipping.id && actions.copyFlash.kind === "quote"}
                query={list.resultFilter.query}
                onSelect={(id) => (selectedId = id)}
                onOpen={startReading}
                onToggleFavorite={toggleStar}
                onCopy={copyContent}
                onCopyQuote={copyQuote}
                onEdit={editNote}
                onRequestReset={requestReset}
                onAddTag={addTagToClipping}
                onRemoveTag={removeTagFromClipping}
                onFilterByTag={toggleTag}
                onFilterByKind={toggleKind}
                onFilterEdited={toggleEditedOnly}
              />
            {/each}
          {:else if !list.loading}
            <div class="py-16 text-center">
              <p class="text-base font-medium">{t("results.empty")}</p>
              <p class="mt-1 text-sm text-fg-muted">
                {#if hasActiveFilters}
                  {t("results.noMatch")}
                {:else}
                  {t("results.noItems")}
                {/if}
              </p>
              {#if hasActiveFilters}
                <button
                  type="button"
                  onclick={clearFilters}
                  class="mt-4 rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium transition hover:bg-surface-hover"
                >
                  {t("results.clear")}
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if list.result && list.result.total > 0}
          <div class="border-t border-line px-6 py-3">
            <Pagination
              page={list.result.page}
              total={list.result.total}
              pageSize={list.result.pageSize}
              onSelect={(next) => (list.page = next)}
              onSizeChange={changePageSize}
            />
          </div>
        {/if}
      </main>
    </div>
  {/if}
</div>

<svelte:window onkeydown={onWindowKeydown} />

{#if imports.dragActive}
  <div class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-8" role="status">
    <div
      class="absolute inset-4 rounded-3xl border-2 border-dashed border-accent bg-surface/90"
    ></div>
    <div class="relative text-center">
      <p class="text-lg font-medium">{t("drop.title")}</p>
      <p class="mt-1 text-sm text-fg-muted">{t("drop.body")}</p>
    </div>
  </div>
{/if}

{#if paletteOpen}
  <CommandPalette onClose={closePalette} onOpen={openPaletteResult} />
{/if}

{#if reading.session && readingClipping}
  <ReadingView
    clipping={readingClipping}
    query={reading.query}
    position={reading.position}
    total={reading.session.total}
    canPrev={reading.canStep("prev")}
    canNext={reading.canStep("next")}
    loading={reading.loading}
    error={reading.error}
    quoted={actions.copyFlash?.id === readingClipping.id && actions.copyFlash.kind === "quote"}
    onCopyQuote={copyReadingQuote}
    onPrev={() => void stepReading("prev")}
    onNext={() => void stepReading("next")}
    onClose={closeReading}
  />
{/if}

{#if stats.open}
  <StatsDialog
    stats={stats.data}
    loading={stats.loading}
    error={stats.error}
    onClose={closeStats}
  />
{/if}

{#if actions.resetTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      aria-label={t("card.cancel")}
      onclick={closeReset}
      class="absolute inset-0 cursor-default bg-black/50"
    ></button>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("card.reset")}
      tabindex={-1}
      use:focusOnMount
      use:trapFocus
      class="relative w-full max-w-md rounded-2xl border border-line bg-surface-raised p-5"
    >
      <p class="text-sm font-medium text-fg">
        {t("card.reset")}
      </p>
      <p class="mt-1 text-sm text-fg-muted">
        {t("card.resetConfirm")}
      </p>
      {#if actions.resetTarget.content}
        <blockquote
          class="mt-3 max-h-48 overflow-y-auto border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-fg"
        >
          {actions.resetTarget.content}
        </blockquote>
      {:else}
        <p class="mt-3 text-sm text-fg-subtle italic">
          {t("card.noText", { kind: t(`kind.${actions.resetTarget.kind}`) })}
        </p>
      {/if}
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onclick={closeReset}
          class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover"
        >
          {t("card.cancel")}
        </button>
        <button
          type="button"
          onclick={confirmResetDialog}
          class="rounded-full bg-danger-solid px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover"
        >
          {t("card.reset")}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if exports.open}
  <ExportDialog
    count={list.result?.total ?? 0}
    scope={exportScope}
    busy={exports.task.busy}
    onClose={closeExport}
    onExport={onExport}
  />
{/if}

{#if library.open}
  <LibraryDialog
    books={sortedBooks}
    files={library.files}
    tags={allTags}
    busy={library.busy}
    status={library.status}
    error={library.error}
    onClose={closeLibrary}
    onRename={libraryRename}
    onMerge={libraryMerge}
    onDeleteBook={libraryDeleteBook}
    onRemoveFile={libraryRemoveFile}
    onRenameTag={libraryRenameTag}
    onMergeTags={libraryMergeTags}
    onDeleteTag={libraryDeleteTag}
  />
{/if}

{#if snapshot.open}
  <RestoreDialog
    fileName={snapshot.file}
    info={snapshot.info}
    checking={snapshot.checking}
    busy={snapshot.busy}
    error={snapshot.error}
    snapshots={snapshot.snapshots}
    snapshotsLoading={snapshot.snapshotsLoading}
    snapshotsError={snapshot.snapshotsError}
    onClose={closeRestore}
    onConfirm={confirmRestore}
    onChooseFile={chooseRestoreFile}
    onSelectSnapshot={inspectRestorePath}
  />
{/if}

{#if prefsOpen}
  <PreferencesDialog
    locale={prefs.locale}
    theme={prefs.themeMode}
    palette={prefs.darkPalette}
    font={prefs.fontScale}
    dbBusy={locatingDb}
    backingUp={snapshot.backup.busy}
    backupStatus={snapshot.backup.status}
    autoBackup={prefs.autoBackupEnabled}
    onLocale={(next) => prefs.setLocale(next)}
    onTheme={prefs.setTheme}
    onPalette={prefs.setDarkPalette}
    onFont={prefs.setFontScale}
    onAutoBackup={prefs.setAutoBackup}
    onOpenDb={openDbFromPreferences}
    onBackup={onBackup}
    onRestore={() => handOffFromPreferences(onRestoreRequest)}
    onShortcuts={() => handOffFromPreferences(openShortcuts)}
    onClose={() => closePreferences()}
  />
{/if}

{#if shortcutsOpen}
  <ShortcutsDialog onClose={closeShortcuts} />
{/if}
