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
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { setContext, tick } from "svelte";
  import { I18N_CONTEXT_KEY, countText, type I18nContext } from "./lib/i18n";
  import {
    readSidebarOpen,
    readSidebarView,
    saveSidebarOpen,
    saveSidebarView,
    type SidebarView,
  } from "./lib/sidebar";
  import {
    exportClippings,
    getDb,
    listTags,
    type DbPort,
    type ImportedFile,
    type TagCount,
  } from "./lib/db";
  import { runImportFlow } from "./lib/importer";
  import { describeError, logger } from "./lib/log";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
  import {
                  type ExportFormat,
  } from "./lib/exporter";
  import {
    withoutTagId,
  } from "./lib/library";
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
  } from "./lib/shortcuts";
  import { focusOnMount, trapFocus } from "./lib/focus";
  import type { BookSortKey } from "./lib/sorting";
import type { Book, ClippingKind, ClippingRow } from "./lib/types";
  import { createBookShelf, createClippingList } from "./lib/app/catalog.svelte";
  import { createPreferences } from "./lib/app/preferences.svelte";
  import { createReadingState } from "./lib/app/reading.svelte";
  import { createLibraryPanel } from "./lib/app/library.svelte";
  import { createSnapshotState } from "./lib/app/snapshot.svelte";
  import { createImportState, type ImportRunner } from "./lib/app/import.svelte";
  import { createExportState } from "./lib/app/export.svelte";
  import { createStatsState } from "./lib/app/stats.svelte";
  import { createClippingActions } from "./lib/app/actions.svelte";
  import { createViewModel } from "./lib/app/viewModel";
  import { ShellBoot } from "./lib/app/boot.svelte";
  import { escapeLayer, Overlays } from "./lib/app/overlays.svelte";
  import {
    dispatchEscape,
    dispatchShortcut,
    type EscapeHandlers,
    type ShortcutHandlers,
  } from "./lib/app/keyboard";

  /** Run one data-layer call with the shared connection. */
  async function withPort<T>(run: (port: DbPort) => Promise<T>): Promise<T> {
    return run(await getDb());
  }

  const list = createClippingList();
  const shelf = createBookShelf();
  let allTags = $state<TagCount[]>([]);

  const prefs = createPreferences();
  const t = prefs.t;
  /** Dialog flags, the selection cursor and the opener focus returns to. */
  const overlays = new Overlays();
  const snapshot = createSnapshotState({
    t,
    refresh: () => refreshAfterLibraryChange(),
  });
  /** Startup effects, hydration and the stored filter live in one module. */
  const boot = new ShellBoot({
    prefs,
    list,
    shelf,
    overlays,
    snapshot,
    getPort: () => getDb(),
    setTags: (tags) => {
      allTags = tags;
    },
    autoBackupEnabled: () => prefs.autoBackupEnabled,
    resetPage: () => {
      list.page = 1;
    },
  });
  const filters = boot.filters;
  let sidebarOpen = $state(readSidebarOpen());
  let sidebarView = $state(readSidebarView());
  let searchExpanded = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);

  let locatingDb = $state(false);
  let importStatus = $state<string | null>(null);
  /** Full-window reading session; null when closed. */
  const reading = createReadingState();
  /** Element that opened the reading view; focus returns to it on close. */
  let listRegion = $state<HTMLElement | null>(null);
  /** Card selected with j/k; the target of Enter, * and c. */

  const library = createLibraryPanel({
    t,
    count: (noun, value) => countText(prefs.locale, noun, value),
    refresh: async () => {
      await boot.loadBooks();
      await list.reload(filters.filter, filters.values.pageSize, filters.sort);
      const port = await getDb();
      allTags = await listTags(port);
    },
    onTagRemoved: (tagId) => {
      filters.values.tagIds = withoutTagId(filters.values.tagIds, tagId);
    },
  });
  setContext<I18nContext>(I18N_CONTEXT_KEY, {
    get locale() {
      return prefs.locale;
    },
    t,
    setLocale: (next) => prefs.setLocale(next),
  });

  const filter = $derived(filters.filter);

  const imports = createImportState({
    t,
    count: (noun, value) => countText(prefs.locale, noun, value),
    refresh: async () => {
      list.page = 1;
      await boot.loadBooks();
      list.resetPage();
      await list.reload(filters.filter, filters.values.pageSize, filters.sort);
    },
  });
  const exports = createExportState({
    loadRows: () => withPort((port) => exportClippings(port, filter)),
    t,
    locale: () => prefs.locale,
    count: (noun, value) => countText(prefs.locale, noun, value),
    bookId: () => filters.values.bookId,
    bookTitle: (bookId) => shelf.books.find((book) => book.id === bookId)?.title ?? null,
    canExport: () => list.result !== null && list.result.total > 0,
  });

  const stats = createStatsState({ t });
  const actions = createClippingActions({
    list,
    reload: () => list.reload(filters.filter, filters.values.pageSize, filters.sort),
    favoritesOnly: () => filters.values.favoritesOnly,
    editedOnly: () => filters.values.editedOnly,
    selectedTagIds: () => filters.values.tagIds,
    readingRow: () => reading.current,
    setTags: (tags) => {
      allTags = tags;
    },
  });


  /** Reading view or a modal: the shell is inert and shortcuts are off. */
  const modalOpen = $derived(
    reading.session !== null ||
      overlays.palette ||
      actions.resetTarget !== null ||
      exports.open ||
      library.open ||
      stats.open ||
      snapshot.open ||
      overlays.preferences ||
      overlays.shortcuts,
  );
  const pages = $derived(Math.max(1, Math.ceil((list.result?.total ?? 0) / filters.values.pageSize)));


  const selectBook = (id: number | null): void => filters.selectBook(id);
  const setBookSortBy = (key: BookSortKey): void => filters.setBookSortBy(key);
  const toggleBookSortDir = (): void => filters.toggleBookSortDir();

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
    if (filters.values.query !== "") {
      filters.values.query = "";
      return;
    }
    searchExpanded = false;
    (event.currentTarget as HTMLInputElement).blur();
  }

  function onSearchBlur(): void {
    if (filters.values.query === "") searchExpanded = false;
  }

  function clearSearch(): void {
    filters.values.query = "";
    searchExpanded = false;
  }

  const toggleKind = (next: ClippingKind): void => filters.toggleKind(next);
  const toggleFavoritesOnly = (): void => filters.toggleFavoritesOnly();
  const toggleEditedOnly = (): void => filters.toggleEditedOnly();
  /** Toggle one author in the OR filter (S4); the list reloads from `filter`. */
  const toggleAuthor = (key: string): void => filters.toggleAuthor(key);
  /** Toggle one tag in the AND filter (S4); the list reloads from `filter`. */
  const toggleTag = (id: number): void => filters.toggleTag(id);
  /** Value shape of the sort select: `<key>:<dir>` (e.g. `page:asc`). */
  const setClippingSort = (value: string): void => filters.setSort(value);

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
  const changePageSize = (size: number): void => filters.setPageSize(size);

  /** Open the reset confirmation dialog for a note (rendered at app root). */
  function requestReset(id: number): void {
    rememberOpener();
    actions.requestReset(id);
  }

  function confirmResetDialog(): Promise<void> {
    return actions.confirmReset();
  }

  /** Open the full-window reading view on one visible row. */
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

  /** Global palette result: the matches become the reading session window. */
  function openPaletteResult(items: ClippingRow[], id: number, query: string): void {
    const opener = overlays.takeOpener();
    overlays.palette = false;
    reading.openWindow(items, id, opener, query);
  }

  /** Close and leave the list on the page where reading stopped. */
  function closeReading(): Promise<void> {
    return reading.close(
      (target) => {
        list.page = target;
      },
      list.page,
      listRegion,
    );
  }

  const rememberOpener = (): void => overlays.rememberOpener();
  /** Focus returns to the opener, or to the list when it unmounted. */
  const restoreOpener = (): void => overlays.restoreOpener(listRegion);

  const openShortcuts = (): void => overlays.openShortcuts();
  const closeShortcuts = (): void => overlays.closeShortcuts(listRegion);
  const openPalette = (): void => overlays.openPalette(modalOpen);
  const closePalette = (): void => overlays.closePalette(listRegion);

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

  const openPreferences = (): void => overlays.openPreferences();
  /** `restoreFocus: false` when another dialog takes over the screen. */
  const closePreferences = (restoreFocus = true): void =>
    overlays.closePreferences(listRegion, restoreFocus);

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
    const next = stepSelection(list.result?.items ?? [], overlays.selectedId, direction);
    if (next === null) return;
    overlays.selectedId = next;
    await tick();
    listRegion
      ?.querySelector<HTMLElement>(`[data-clipping-id="${next}"]`)
      ?.focus();
  }

  function stepPage(direction: "next" | "prev"): void {
    const next = direction === "next" ? list.page + 1 : list.page - 1;
    if (next < 1 || next > pages) return;
    list.page = next;
    overlays.selectedId = null;
  }

  /** One handler per resolved shortcut; the shell owns the actions. */
  const shortcutHandlers: ShortcutHandlers = {
    openSearch: () => void openSearch(),
    openPalette,
    openShortcuts,
    toggleSidebar,
    openFilters: () => overlays.openFilters(),
    openPreferences,
    nextClipping: () => void moveSelection("next"),
    prevClipping: () => void moveSelection("prev"),
    openClipping: () => {
      if (overlays.selectedId !== null) startReading(overlays.selectedId);
    },
    toggleFavorite: () => {
      if (overlays.selectedId !== null) void toggleStar(overlays.selectedId);
    },
    copyClipping: () => {
      if (overlays.selectedId !== null) void copyContent(overlays.selectedId);
    },
    copyQuote: () => {
      if (overlays.selectedId !== null) void copyQuote(overlays.selectedId);
    },
    nextPage: () => stepPage("next"),
    prevPage: () => stepPage("prev"),
  };

  /** Escape handlers; the busy read stays live through the getter. */
  const escapeHandlers: EscapeHandlers = {
    busy: () => ({
      export: exports.task.busy,
      library: library.busy,
      restore: snapshot.busy,
    }),
    closePalette,
    closeShortcuts,
    closeReset,
    closeExport,
    closeLibrary,
    closeStats,
    closeRestore,
    closePreferences: () => closePreferences(),
    closeFilters: () => overlays.closeFilters(),
    clearQuery: () => {
      filters.values.query = "";
    },
    foldSearch: () => {
      searchExpanded = false;
    },
    clearSelection: () => overlays.clearSelection(),
  };

  /** One window listener: Escape closes one layer, everything else resolves. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;

    if (event.key === "Escape") {
      const layer = escapeLayer({
        reading: reading.session !== null,
        palette: overlays.palette,
        shortcuts: overlays.shortcuts,
        reset: actions.resetTarget !== null,
        exportOpen: exports.open,
        library: library.open,
        stats: stats.open,
        restore: snapshot.open,
        preferences: overlays.preferences,
        filters: overlays.filters,
        query: filters.values.query,
        searchExpanded,
        selection: overlays.selectedId !== null,
      });
      if (layer === "none" || layer === "reading") return;
      event.preventDefault();
      dispatchEscape(layer, escapeHandlers);
      return;
    }

    // ? toggles the help it opened.
    if (overlays.shortcuts && event.key === "?") {
      event.preventDefault();
      closeShortcuts();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const action = resolveShortcut(event, {
      typing: isTypingTarget(target),
      interactive: isInteractiveTarget(target),
      overlay: modalOpen || overlays.filters,
      hasLibrary: view.hasLibrary,
      hasResults: (list.result?.items.length ?? 0) > 0,
      hasSelection: overlays.selectedId !== null,
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
    dispatchShortcut(action, shortcutHandlers);
  }

  /** Step one row; fetch the adjacent page only when the window runs out. */
  function stepReading(dir: ReadingDirection): Promise<void> {
    return reading.step(dir);
  }

  function clearFilters(): void {
    filters.clear();
    searchExpanded = false;
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
    await boot.loadBooks();
    await list.reload(filters.filter, filters.values.pageSize, filters.sort);
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

  boot.mount();

  /** Row shown full-window; null while the reading view is closed. */
  const readingClipping = $derived(reading.current);

  const view = createViewModel({
    books: () => shelf.books,
    tags: () => allTags,
    values: () => filters.values,
    total: () => list.result?.total ?? 0,
    t,
    toggleKind,
    toggleFavorites: toggleFavoritesOnly,
    toggleEdited: toggleEditedOnly,
    toggleAuthor,
    toggleTag,
  });
</script>

<div class="flex h-full flex-col" inert={modalOpen}>
  <header
    class="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2">
      {#if view.hasLibrary}
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

  {#if !view.hasLibrary && !list.loading}
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
          books={view.sortedBooks}
          groups={view.authorGroups}
          view={sidebarView}
          onViewChange={setSidebarView}
          selectedId={filters.values.bookId}
          totalCount={view.libraryTotal}
          onSelect={selectBook}
          sortBy={filters.values.bookSortBy}
          sortDir={filters.values.bookSortDir}
          onSortBy={setBookSortBy}
          onSortDirToggle={toggleBookSortDir}
          onImport={onImport}
          importing={imports.busy}
          onOpenLibrary={openLibrary}
          onOpenStats={openStats}
          libraryActionsDisabled={!view.hasLibrary}
        />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3"
        >
          <div class="flex min-w-0 flex-1 items-center">
            {#if searchExpanded || filters.values.query !== ""}
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
                  bind:value={filters.values.query}
                  onkeydown={onSearchKeydown}
                  onblur={onSearchBlur}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.placeholder")}
                  class="w-full rounded-full border border-line bg-surface-inset py-2 pr-8 pl-9 text-sm outline-none placeholder:text-fg-subtle focus:border-line-strong"
                />
                {#if filters.values.query !== ""}
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
            bind:open={overlays.filters}
            authors={filters.values.authors}
            authorGroups={view.authorGroups}
            kinds={filters.values.kinds}
            favoritesOnly={filters.values.favoritesOnly}
            editedOnly={filters.values.editedOnly}
            tagIds={filters.values.tagIds}
            tags={view.filterTags}
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
                value={`${filters.values.sortBy}:${filters.values.sortDir}`}
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
              title={view.exportSummary}
              aria-label={view.exportSummary}
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

        {#if view.activeChips.length > 0}
          <div
            class="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2"
          >
            {#each view.activeChips as chip (chip.key)}
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
                onSelect={(id) => (overlays.selectedId = id)}
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
                {#if view.hasActiveFilters}
                  {t("results.noMatch")}
                {:else}
                  {t("results.noItems")}
                {/if}
              </p>
              {#if view.hasActiveFilters}
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

{#if overlays.palette}
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
    scope={view.exportScope}
    busy={exports.task.busy}
    onClose={closeExport}
    onExport={onExport}
  />
{/if}

{#if library.open}
  <LibraryDialog
    books={view.sortedBooks}
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

{#if overlays.preferences}
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

{#if overlays.shortcuts}
  <ShortcutsDialog onClose={closeShortcuts} />
{/if}
