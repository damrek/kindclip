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
  import { confirm, open, save } from "@tauri-apps/plugin-dialog";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { setContext, tick } from "svelte";
  import {
    I18N_CONTEXT_KEY,
    isLocale,
    loadLocale,
    translate,
    type I18nContext,
    type I18nKey,
    type Locale,
    type TranslateParams,
  } from "./lib/i18n";
  import {
    applyTheme,
    isDarkPalette,
    loadDarkPalette,
    loadThemeMode,
    resolveTheme,
    saveDarkPalette,
    saveThemeMode,
    systemPrefersDark,
    type DarkPalette,
    type ThemeMode,
  } from "./lib/theme";
  import {
    applyFontScale,
    loadFontScale,
    saveFontScale,
    type FontScale,
  } from "./lib/font";
  import {
    readSidebarOpen,
    readSidebarView,
    saveSidebarOpen,
    saveSidebarView,
    type SidebarView,
  } from "./lib/sidebar";
  import {
    addClippingTag,
    closeDb,
    deleteBook,
    deleteTag,
    ensureTag,
    exportClippings,
    getDb,
    getSetting,
    listBooks,
    listClippings,
    listImportedFiles,
    listTags,
    loadFilterState,
    mergeBooks,
    mergeTags,
    removeClippingTag,
    removeImportedFile,
    renameBook,
    renameTag,
    resetNote,
    setSetting,
    SETTINGS_KEYS,
    toggleFavorite,
    updateNote,
    type DbPort,
    type ImportedFile,
    type RenameBookResult,
    type RenameTagResult,
    type StoredFilterState,
    type TagCount,
  } from "./lib/db";
  import { runImportFlow, pickDroppedFile, runImportFromPath, tauriImportDeps, type ImportDeps, type ImportOutcome } from "./lib/importer";
  import { describeError, logger } from "./lib/log";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
  import {
    AUTO_BACKUP_KEEP,
    BACKUP_EXTENSION,
    autoBackupDue,
    backupFileName,
    baseName,
    inspectBackupFile,
    isBackupError,
    schemaVersion,
    selectAutoBackupsToDelete,
    type AutoBackup,
    type AutoBackupPaths,
    type AutoBackupPruneReport,
    type BackupInfo,
  } from "./lib/backup";
  import {
    exportFileName,
    groupRowsByBook,
    planBookFileNames,
    serializeBookMarkdown,
    serializeCsv,
    serializeJson,
    serializeMarkdown,
    type ExportFormat,
  } from "./lib/exporter";
  import {
    applyFavoriteToggle,
    applyNoteEdit,
    clampPage,
    copyClippingContent,
    debounce,
    formatQuoteCitation,
    groupBooksByAuthor,
    totalClippings,
    withTag,
    pruneAuthors,
    withoutTag,
    withoutTagId,
    emptyFilter,
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
    DEFAULT_CLIPPING_SORT,
    sortBooks,
    type BookSortKey,
    type ClippingSort,
  } from "./lib/sorting";
  import {
    advanceReading,
    canStep,
    openReadingSession,
    openWindowSession,
    pageToLoad,
    readingCurrent,
    readingPage,
    readingPosition,
    stepWithinWindow,
    type ReadingDirection,
    type ReadingSession,
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
  import type {
    Book,
    ClippingFilter,
    ClippingKind,
    ClippingRow,
    PagedResult,
    Tag,
  } from "./lib/types";
  import { loadReadingStats, type ReadingStats } from "./lib/stats";

  let books = $state<Book[]>([]);
  /** Set after the first successful book load; gates author pruning. */
  let booksLoaded = $state(false);
  let allTags = $state<TagCount[]>([]);
  let result = $state<PagedResult<ClippingRow> | null>(null);
  /** True from boot: the stored filter is applied before the first list load. */
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  /** Invalidates an in-flight list load when a newer one starts. */
  let listRequest = 0;
  /** Filter and sort that produced `result`, committed atomically with it.
   * Reactive because the cards and the reading view highlight its query. */
  let resultFilter = $state<ClippingFilter>(emptyFilter());
  let resultSort: ClippingSort = DEFAULT_CLIPPING_SORT;
  /** Set once the stored filter has been applied; gates load and save. */
  let prefsReady = $state(false);

  let filters = $state<FilterValues>(emptyFilters());
  let sidebarOpen = $state(readSidebarOpen());
  let sidebarView = $state<SidebarView>(readSidebarView());
  let searchExpanded = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);
  let page = $state(1);

  let importing = $state(false);
  /** Files are being dragged over the window (native Tauri drag & drop). */
  let dragActive = $state(false);
  let locatingDb = $state(false);
  let importStatus = $state<string | null>(null);
  let exportOpen = $state(false);
  let exporting = $state(false);
  let exportStatus = $state<string | null>(null);
  let backingUp = $state(false);
  let backupStatus = $state<string | null>(null);
  /** Daily snapshot preference; on unless the user turned it off. */
  let autoBackupEnabled = $state(true);
  /** One launch attempt only: set once the first library load finished. */
  let autoBackupStarted = false;
  /** Automatic snapshots shown in the restore dialog, newest first. */
  let autoBackups = $state<AutoBackup[]>([]);
  let autoBackupsLoading = $state(false);
  let autoBackupsError = $state<string | null>(null);
  let restoreOpen = $state(false);
  let restoreBusy = $state(false);
  let restoreChecking = $state(false);
  let restorePath = $state<string | null>(null);
  let restoreFile = $state("");
  let restoreInfo = $state<BackupInfo | null>(null);
  let restoreError = $state<string | null>(null);
  let restoreRequest = 0;
  let libraryOpen = $state(false);
  let libraryBusy = $state(false);
  let libraryFiles = $state<ImportedFile[]>([]);
  let libraryStatus = $state<string | null>(null);
  let libraryError = $state<string | null>(null);
  let statsOpen = $state(false);
  let statsLoading = $state(false);
  let statsData = $state<ReadingStats | null>(null);
  let statsError = $state<string | null>(null);
  /** Invalidates an in-flight stats load when the dialog closes or reopens. */
  let statsRequest = 0;
  /** Which copy action just succeeded, for its 1.5 s check mark. */
  let copyFlash = $state<{ id: number; kind: "content" | "quote" } | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Full-window reading session; null when closed. */
  let reading = $state<ReadingSession | null>(null);
  let readingLoading = $state(false);
  let readingError = $state<string | null>(null);
  /** Invalidates an in-flight page load when the session closes or restarts. */
  let readingRequest = 0;
  /** Filter/sort snapshot the reading window fetches adjacent pages with. */
  let readingSource = $state<{ filter: ClippingFilter; sort: ClippingSort } | null>(null);
  /** Search text the reading view highlights; from the list or the palette. */
  let readingQuery = $state("");
  /** Element that opened the reading view; focus returns to it on close. */
  let readingOpener: HTMLElement | null = null;
  /** Scroller holding the cards; the focus fallback when the opener is gone. */
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
  /** Note pending reset confirmation (dialog rendered at app root). */
  let resetTarget = $state<ClippingRow | null>(null);
  let locale = $state<Locale>(loadLocale(readStoredLocale()));
  let themeMode = $state<ThemeMode>(loadThemeMode());
  let darkPalette = $state<DarkPalette>(loadDarkPalette());
  let fontScale = $state<FontScale>(loadStoredFontScale());

  /** Reading view or a modal: the shell is inert and shortcuts are off. */
  const modalOpen = $derived(
    reading !== null ||
      paletteOpen ||
      resetTarget !== null ||
      exportOpen ||
      libraryOpen ||
      statsOpen ||
      restoreOpen ||
      prefsOpen ||
      shortcutsOpen,
  );
  const pages = $derived(Math.max(1, Math.ceil((result?.total ?? 0) / filters.pageSize)));

  function readStoredFontScale(): string | null {
    try {
      return localStorage.getItem("kindclip-font-scale");
    } catch {
      return null;
    }
  }

  function loadStoredFontScale(): FontScale {
    return loadFontScale(readStoredFontScale());
  }

  function readStoredLocale(): string | null {
    try {
      return localStorage.getItem("kindclip-locale");
    } catch {
      return null;
    }
  }

  function t(key: I18nKey, params?: TranslateParams): string {
    return translate(locale, key, params);
  }

  function setLocale(next: Locale): void {
    locale = next;
    try {
      localStorage.setItem("kindclip-locale", next);
    } catch {
      // Non-fatal: the language simply won't persist.
    }
    void persistSetting(SETTINGS_KEYS.locale, next);
  }

  /** Best-effort DB write; preferences must never break the UI. */
  async function persistSetting(key: string, value: string): Promise<void> {
    try {
      const port = await getDb();
      await setSetting(port, key, value);
    } catch {
      // Non-fatal.
    }
  }

  function setTheme(next: ThemeMode): void {
    themeMode = next;
    saveThemeMode(next); // fast cache for the pre-paint script
    applyTheme(
      document.documentElement,
      resolveTheme(next, systemPrefersDark(), darkPalette),
    );
    void persistSetting(SETTINGS_KEYS.theme, next);
  }

  function setDarkPalette(next: DarkPalette): void {
    darkPalette = next;
    saveDarkPalette(next); // fast cache for the pre-paint script
    applyTheme(
      document.documentElement,
      resolveTheme(themeMode, systemPrefersDark(), next),
    );
    void persistSetting(SETTINGS_KEYS.darkPalette, next);
  }

  function setFontScale(next: FontScale): void {
    fontScale = next;
    saveFontScale(next); // fast cache for the pre-paint script
    applyFontScale(document.documentElement, next);
    void persistSetting(SETTINGS_KEYS.fontScale, next);
  }

  function setAutoBackup(next: boolean): void {
    autoBackupEnabled = next;
    void persistSetting(SETTINGS_KEYS.autoBackup, next ? "1" : "0");
  }

  /** Live system preference: the theme follows macOS while the choice is "system". */
  $effect(() => {
    const mode = themeMode;
    const palette = darkPalette;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void =>
      applyTheme(document.documentElement, resolveTheme(mode, media.matches, palette));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  });

  $effect(() => {
    applyFontScale(document.documentElement, fontScale);
  });

  setContext<I18nContext>(I18N_CONTEXT_KEY, {
    get locale() {
      return locale;
    },
    t,
    setLocale,
  });

  const filter = $derived(toFilter(filters));
  const clippingSort = $derived(clippingSortOf(filters));

  const scheduleQuery = debounce((value: string) => {
    filters.debouncedQuery = value;
    page = 1;
  }, 250);

  async function loadList(
    f: ClippingFilter,
    p: number,
    s: number,
    sort: ClippingSort,
  ): Promise<void> {
    const request = ++listRequest;
    loading = true;
    loadError = null;
    try {
      const port = await getDb();
      const first = await listClippings(port, f, { page: p, pageSize: s }, sort);
      if (request !== listRequest) return; // Superseded by a newer filter or page.
      const last = clampPage(p, first.total, s);
      const next =
        last === p
          ? first
          : await listClippings(port, f, { page: last, pageSize: s }, sort);
      if (request !== listRequest) return;
      // Commit rows and the filter that produced them together: the reading
      // view must never fetch a page with a filter other than this one.
      result = next;
      resultFilter = {
        ...f,
        authors: [...f.authors],
        kinds: [...f.kinds],
        tagIds: [...f.tagIds],
      };
      resultSort = sort;
      page = last;
    } catch (error) {
      if (request === listRequest) {
        loadError = describeError(error);
      }
      logger.error("list-load", error);
    } finally {
      if (request === listRequest) {
        loading = false;
      }
    }
  }

  async function loadBooks(): Promise<void> {
    try {
      const port = await getDb();
      books = await listBooks(port);
      booksLoaded = true;
      if (filters.bookId !== null && !books.some((book) => book.id === filters.bookId)) {
        // Persisted book gone (fresh DB, re-import, …): fall back to all.
        filters.bookId = null;
        page = 1;
      }
    } catch (error) {
      loadError = describeError(error);
      logger.error("books-load", error);
    }
  }

  /** Once on startup: DB is the source of truth, caches seed it on first run. */
  async function loadPreferences(): Promise<void> {
    try {
      const port = await getDb();
      const [dbLocale, dbTheme, dbPalette, dbFontScale, dbAutoBackup, dbFilter, dbTags] =
        await Promise.all([
          getSetting(port, SETTINGS_KEYS.locale),
          getSetting(port, SETTINGS_KEYS.theme),
          getSetting(port, SETTINGS_KEYS.darkPalette),
          getSetting(port, SETTINGS_KEYS.fontScale),
          getSetting(port, SETTINGS_KEYS.autoBackup),
          loadFilterState(port),
          listTags(port),
        ]);
      allTags = dbTags;
      if (dbLocale && isLocale(dbLocale)) {
        locale = dbLocale;
      } else {
        await setSetting(port, SETTINGS_KEYS.locale, locale);
      }
      if (isDarkPalette(dbPalette)) {
        darkPalette = dbPalette;
        saveDarkPalette(dbPalette);
        applyTheme(
          document.documentElement,
          resolveTheme(themeMode, systemPrefersDark(), dbPalette),
        );
      } else {
        await setSetting(port, SETTINGS_KEYS.darkPalette, darkPalette);
      }
      if (dbTheme === "light" || dbTheme === "dark" || dbTheme === "system") {
        themeMode = dbTheme;
        saveThemeMode(dbTheme);
        applyTheme(
          document.documentElement,
          resolveTheme(dbTheme, systemPrefersDark(), darkPalette),
        );
      } else {
        await setSetting(port, SETTINGS_KEYS.theme, themeMode);
      }
      if (dbFontScale === "small" || dbFontScale === "medium" || dbFontScale === "large") {
        fontScale = dbFontScale;
        saveFontScale(dbFontScale);
        applyFontScale(document.documentElement, dbFontScale);
      } else {
        await setSetting(port, SETTINGS_KEYS.fontScale, fontScale);
      }
      if (dbAutoBackup === "0") {
        autoBackupEnabled = false;
      } else {
        autoBackupEnabled = true;
        if (dbAutoBackup === null) {
          await setSetting(port, SETTINGS_KEYS.autoBackup, "1");
        }
      }
      if (dbFilter) {
        const restored = fromStored(dbFilter);
        // Drop ids whose tag is gone (same guard as the book id).
        restored.tagIds = keepKnownTags(
          restored.tagIds,
          dbTags.map((tag) => tag.id),
        );
        filters = restored;
        page = 1;
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
    await persistSetting(SETTINGS_KEYS.filter, JSON.stringify(state));
  }

  const saveFilters = debounce((state: StoredFilterState) => {
    void persistFilterState(state);
  }, 500);

  $effect(() => {
    scheduleQuery(filters.query);
  });

  // NOTE: $effect only tracks state read SYNCHRONOUSLY in its body.
  // loadList reads filter/page/filters.pageSize after an await, so they must be
  // passed as arguments here — otherwise the list loads once on mount
  // and filters/pagination/sidebar silently stop working.
  //
  // Waiting for prefsReady keeps the first load from running with the empty
  // default filter: the stored filters.kinds must be applied first, or a list saved
  // as notes + highlights flashes every kind (bookmarks included) and a slow
  // cold start can leave that unfiltered page on screen.
  $effect(() => {
    if (!prefsReady) return;
    void loadList(filter, page, filters.pageSize, clippingSort);
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
    if (!prefsReady || loading || autoBackupStarted) return;
    autoBackupStarted = true;
    if (autoBackupEnabled) {
      void runAutoBackup();
    }
  });

  // Snapshot passed synchronously (see the loadList NOTE above): the debounced
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
    if (!prefsReady || !booksLoaded) return;
    const next = pruneAuthors(filters.authors, books);
    if (next !== filters.authors) {
      filters.authors = next;
      page = 1;
    }
  });

  $effect(() => {
    document.documentElement.lang = locale;
  });

  /** A reload that drops the selected row (page, filter, delete) clears it. */
  $effect(() => {
    if (selectedId === null) return;
    if (result === null || !result.items.some((item) => item.id === selectedId)) {
      selectedId = null;
    }
  });

  function selectBook(id: number | null): void {
    filters.bookId = id;
    page = 1;
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
    page = 1;
  }

  function toggleFavoritesOnly(): void {
    filters.favoritesOnly = !filters.favoritesOnly;
    page = 1;
  }

  function toggleEditedOnly(): void {
    filters.editedOnly = !filters.editedOnly;
    page = 1;
  }

  /** Toggle one author in the OR filter (S4); the list reloads from `filter`. */
  function toggleAuthor(key: string): void {
    filters.authors = toggleValue(filters.authors, key);
    page = 1;
  }

  /** Toggle one tag in the AND filter (S4); the list reloads from `filter`. */
  function toggleTag(id: number): void {
    filters.tagIds = toggleValue(filters.tagIds, id);
    page = 1;
  }

  /** Value shape of the sort select: `<key>:<dir>` (e.g. `page:asc`). */
  function setClippingSort(value: string): void {
    const [key, dir] = value.split(":");
    if (key !== "date" && key !== "title" && key !== "page") return;
    if (dir !== "asc" && dir !== "desc") return;
    filters.sortBy = key;
    filters.sortDir = dir;
    page = 1;
  }

  function flashCopied(id: number, kind: "content" | "quote"): void {
    copyFlash = { id, kind };
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
    }
    copyTimer = setTimeout(() => {
      copyFlash = null;
      copyTimer = null;
    }, 1500);
  }

  async function copyContent(id: number): Promise<void> {
    const target = result?.items.find((item) => item.id === id);
    const text = target ? (target.content_edited ?? target.content) : null;
    if (!text) return;
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    const ok = await copyClippingContent(writeText, text);
    if (ok) {
      flashCopied(id, "content");
    }
  }

  /** Markdown quote with author, book and page, for the clipboard. */
  async function copyQuote(id: number): Promise<void> {
    const target =
      result?.items.find((item) => item.id === id) ??
      (readingClipping?.id === id ? readingClipping : null);
    if (!target) return;
    const text = formatQuoteCitation(target);
    if (text === null) return;
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    const ok = await copyClippingContent(writeText, text);
    if (ok) {
      flashCopied(id, "quote");
    }
  }

  function copyReadingQuote(): void {
    if (readingClipping) {
      void copyQuote(readingClipping.id);
    }
  }

  async function toggleStar(id: number): Promise<void> {    const current = result?.items.find((item) => item.id === id);
    if (!current || !result) return;
    const next = !current.favorite;
    result = { ...result, items: applyFavoriteToggle(result.items, id, next) };
    try {
      const port = await getDb();
      const confirmed = await toggleFavorite(port, id);
      result = { ...result, items: applyFavoriteToggle(result.items, id, confirmed) };
      if (filters.favoritesOnly && !confirmed) {
        // The unstarred card no longer belongs to this view.
        await loadList(filter, page, filters.pageSize, clippingSort);
      }
    } catch (error) {
      result = { ...result, items: applyFavoriteToggle(result.items, id, current.favorite) };
      loadError = describeError(error);
    }
  }

  function changePageSize(size: number): void {
    filters.pageSize = size;
    page = 1;
  }

  /** Patch the tag chips of one visible row, leaving the rest untouched. */
  function patchClippingTags(id: number, update: (tags: Tag[]) => Tag[]): void {
    if (!result) return;
    result = {
      ...result,
      items: result.items.map((item) =>
        item.id === id ? { ...item, tags: update(item.tags) } : item,
      ),
    };
  }

  /** Assign a tag to a clipping, creating it by name when needed (S3). */
  async function addTagToClipping(id: number, name: string): Promise<boolean> {
    const current = result?.items.find((item) => item.id === id);
    const clean = name.trim();
    if (!current || clean === "") return false;
    if (current.tags.some((tag) => tag.name.toLowerCase() === clean.toLowerCase())) {
      return false;
    }
    const before = current.tags;
    const tempId = -Date.now();
    patchClippingTags(id, (tags) => withTag(tags, { id: tempId, name: clean }));
    try {
      const port = await getDb();
      const tagId = await ensureTag(port, clean);
      if (tagId === null) {
        patchClippingTags(id, () => before);
        return false;
      }
      await addClippingTag(port, id, tagId);
      allTags = await listTags(port);
      const canonical = allTags.find((tag) => tag.id === tagId)?.name ?? clean;
      patchClippingTags(id, (tags) =>
        withTag(withoutTag(tags, tempId), { id: tagId, name: canonical }),
      );
      return true;
    } catch (error) {
      patchClippingTags(id, () => before);
      loadError = describeError(error);
      return false;
    }
  }

  /** Remove one tag from a clipping, reverting the chip on failure (S3). */
  async function removeTagFromClipping(id: number, tagId: number): Promise<boolean> {
    const current = result?.items.find((item) => item.id === id);
    if (!current || !current.tags.some((tag) => tag.id === tagId)) return false;
    const before = current.tags;
    patchClippingTags(id, (tags) => withoutTag(tags, tagId));
    try {
      const port = await getDb();
      await removeClippingTag(port, id, tagId);
      allTags = await listTags(port);
      if (filters.tagIds.includes(tagId)) {
        // The card no longer carries every selected tag.
        await loadList(filter, page, filters.pageSize, clippingSort);
      }
      return true;
    } catch (error) {
      patchClippingTags(id, () => before);
      loadError = describeError(error);
      return false;
    }
  }

  /** Overlay note edit (V2): reconciled write, then patch the visible row. */
  async function editNote(id: number, content: string): Promise<boolean> {
    if (!result) return false;
    try {
      const port = await getDb();
      const confirmed = await updateNote(port, id, content);
      if (confirmed) {
        result = {
          ...result,
          items: applyNoteEdit(result.items, id, {
            content_edited: content,
            edited_at: new Date().toISOString(),
          }),
        };
      }
      return confirmed;
    } catch (error) {
      loadError = describeError(error);
      return false;
    }
  }

  async function resetNoteToOriginal(id: number): Promise<boolean> {
    if (!result) return false;
    try {
      const port = await getDb();
      const confirmed = await resetNote(port, id);
      if (confirmed) {
        result = {
          ...result,
          items: applyNoteEdit(result.items, id, { content_edited: null, edited_at: null }),
        };
        if (filters.editedOnly) {
          // The reset note no longer belongs to this view.
          await loadList(filter, page, filters.pageSize, clippingSort);
        }
      }
      return confirmed;
    } catch (error) {
      loadError = describeError(error);
      return false;
    }
  }

  /** Open the reset confirmation dialog for a note (rendered at app root). */
  function requestReset(id: number): void {
    rememberOpener();
    resetTarget = result?.items.find((item) => item.id === id) ?? null;
  }

  async function confirmResetDialog(): Promise<void> {
    if (!resetTarget) return;
    if (await resetNoteToOriginal(resetTarget.id)) {
      resetTarget = null;
    }
  }

  /** Mount a reading session and remember the source its arrows may fetch from. */
  function mountReading(
    session: ReadingSession,
    source: { filter: ClippingFilter; sort: ClippingSort } | null,
    opener: HTMLElement | null,
    query: string,
  ): void {
    readingRequest += 1;
    readingError = null;
    readingLoading = false;
    readingSource = source;
    readingQuery = query;
    readingOpener = opener;
    reading = session;
  }

  /** Open the full-window reading view on one visible row. */
  function startReading(id: number): void {
    if (!result) return;
    const session = openReadingSession(result, id);
    if (!session) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mountReading(
      session,
      { filter: resultFilter, sort: resultSort },
      opener,
      resultFilter.query,
    );
  }

  /** Global palette result: the matches become the reading window. */
  function openPaletteResult(items: ClippingRow[], id: number, query: string): void {
    const session = openWindowSession(items, id);
    if (!session) return;
    const opener = modalOpener;
    paletteOpen = false;
    modalOpener = null;
    mountReading(session, null, opener, query);
  }

  /** Close and leave the list on the page where reading stopped. */
  async function closeReading(): Promise<void> {
    if (!reading) return;
    // Palette windows are not part of the list, so they never move its page.
    const fromList = readingSource !== null;
    const targetPage = fromList ? readingPage(reading) : page;
    const opener = readingOpener;
    readingRequest += 1;
    reading = null;
    readingLoading = false;
    readingError = null;
    readingSource = null;
    readingQuery = "";
    readingOpener = null;
    const pageChanged = targetPage !== page;
    if (pageChanged) {
      page = targetPage;
    }
    // Hand focus back. On the same page the opener is still mounted, so focus
    // returns to it; a page change reloads the list and unmounts it, so focus
    // parks on the list itself instead of dropping to <body>.
    await tick();
    const target =
      !pageChanged && opener !== null && opener.isConnected ? opener : listRegion;
    target?.focus();
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
    if (resetTarget === null) return;
    resetTarget = null;
    restoreOpener();
  }

  function closeExport(): void {
    if (!exportOpen) return;
    exportOpen = false;
    restoreOpener();
  }

  function closeLibrary(): void {
    if (!libraryOpen) return;
    libraryOpen = false;
    restoreOpener();
  }

  /** S1: whole-library aggregates, fetched fresh each time the dialog opens. */
  async function openStats(): Promise<void> {
    if (statsOpen) return;
    rememberOpener();
    statsOpen = true;
    statsData = null;
    statsError = null;
    statsLoading = true;
    const request = ++statsRequest;
    try {
      const data = await loadReadingStats(await getDb());
      if (request === statsRequest) {
        statsData = data;
      }
    } catch (error) {
      if (request === statsRequest) {
        statsError = t("stats.error", {
          message: describeError(error),
        });
      }
    } finally {
      if (request === statsRequest) {
        statsLoading = false;
      }
    }
  }

  function closeStats(): void {
    if (!statsOpen) return;
    statsRequest += 1;
    statsOpen = false;
    statsLoading = false;
    statsError = null;
    restoreOpener();
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
    const next = stepSelection(result?.items ?? [], selectedId, direction);
    if (next === null) return;
    selectedId = next;
    await tick();
    listRegion
      ?.querySelector<HTMLElement>(`[data-clipping-id="${next}"]`)
      ?.focus();
  }

  function stepPage(direction: "next" | "prev"): void {
    const next = direction === "next" ? page + 1 : page - 1;
    if (next < 1 || next > pages) return;
    page = next;
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
      // The reading view owns its own Escape and arrows.
      if (reading !== null) return;
      if (paletteOpen) {
        event.preventDefault();
        closePalette();
        return;
      }
      if (shortcutsOpen) {
        event.preventDefault();
        closeShortcuts();
        return;
      }
      if (resetTarget !== null) {
        event.preventDefault();
        closeReset();
        return;
      }
      if (exportOpen) {
        event.preventDefault();
        if (!exporting) closeExport();
        return;
      }
      if (libraryOpen) {
        event.preventDefault();
        if (!libraryBusy) closeLibrary();
        return;
      }
      if (statsOpen) {
        event.preventDefault();
        closeStats();
        return;
      }
      if (restoreOpen) {
        event.preventDefault();
        if (!restoreBusy) closeRestore();
        return;
      }
      if (prefsOpen) {
        event.preventDefault();
        closePreferences();
        return;
      }
      if (filtersOpen) {
        event.preventDefault();
        filtersOpen = false;
        return;
      }
      if (filters.query !== "") {
        event.preventDefault();
        filters.query = "";
        return;
      }
      if (searchExpanded) {
        event.preventDefault();
        searchExpanded = false;
        return;
      }
      if (selectedId !== null) {
        event.preventDefault();
        selectedId = null;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      return;
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
      hasResults: (result?.items.length ?? 0) > 0,
      hasSelection: selectedId !== null,
      canPrevPage: page > 1,
      canNextPage: page < pages,
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
  async function stepReading(dir: ReadingDirection): Promise<void> {
    const session = reading;
    if (!session || readingLoading) return;
    const moved = stepWithinWindow(session, dir);
    if (moved) {
      // A successful step dismisses a banner left over from a failed fetch.
      readingError = null;
      reading = moved;
      return;
    }
    // A window-only session (palette results) has no adjacent pages.
    const source = readingSource;
    if (!source || pageToLoad(session, dir) === null) return;
    const request = ++readingRequest;
    readingLoading = true;
    readingError = null;
    try {
      const port = await getDb();
      const next = await advanceReading(session, dir, (page, size) =>
        listClippings(port, source.filter, { page, pageSize: size }, source.sort),
      );
      if (request !== readingRequest) return; // Closed or reopened while loading.
      reading = next;
    } catch (error) {
      if (request === readingRequest) {
        readingError = describeError(error);
      }
    } finally {
      // Replacing the session on success must still release the busy flag.
      if (request === readingRequest) {
        readingLoading = false;
      }
    }
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

  type ImportRunner = (
    deps: ImportDeps,
    onProgress: (done: number, total: number) => void,
  ) => Promise<ImportOutcome>;

  async function onImport(): Promise<void> {
    await performImport(runImportFlow);
  }

  /** S1: one import run for both the picker and a native file drop. */
  async function performImport(run: ImportRunner): Promise<void> {
    if (importing) return;
    importing = true;
    importStatus = t("import.reading");
    try {
      const outcome = await run(tauriImportDeps(), (done, total) => {
        importStatus = t("import.progress", { done, total });
      });
      if (outcome.status === "cancelled") {
        importStatus = null;
      } else if (outcome.status === "empty") {
        importStatus =
          outcome.skipped > 0
            ? t("import.emptySkipped", { path: outcome.path, skipped: outcome.skipped })
            : t("import.empty", { path: outcome.path });
        logger.info(`import: no clippings, ${outcome.skipped} skipped`);
      } else {
        const report = outcome.report;
        logger.info(
          `import: ${report.inserted} inserted, ${report.duplicates} duplicates, ${report.skipped} skipped, ${report.bookCount} books`,
        );
        importStatus =
          report.alreadyImported && report.skipped === 0
            ? t("import.duplicate")
            : report.skipped > 0
              ? t("import.doneSkipped", {
                  inserted: report.inserted,
                  total: report.total,
                  duplicates: report.duplicates,
                  skipped: report.skipped,
                  books: report.bookCount,
                })
              : t("import.done", {
                  inserted: report.inserted,
                  total: report.total,
                  duplicates: report.duplicates,
                  books: report.bookCount,
                });
        page = 1;
        await loadBooks();
        await loadList(filter, 1, filters.pageSize, clippingSort);
      }
    } catch (error) {
      importStatus = t("import.error", {
        message: describeError(error),
      });
      logger.error("import", error);
    } finally {
      importing = false;
    }
  }

  /** S1: a native file drop imports the first `.txt` it carries. */
  function onDropPaths(paths: string[]): void {
    if (importing || modalOpen) return;
    const path = pickDroppedFile(paths);
    if (path === null) {
      importStatus = t("import.notTxt");
      return;
    }
    void performImport((deps, onProgress) => runImportFromPath(deps, path, onProgress));
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
          dragActive = !modalOpen && !importing;
        } else if (payload.type === "leave") {
          dragActive = false;
        } else if (payload.type === "drop") {
          dragActive = false;
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
    if (!result || result.total === 0) return;
    rememberOpener();
    exportStatus = null;
    exportOpen = true;
  }

  /** S6/S7: one Markdown file per book into a chosen folder. */
  async function exportOneFilePerBook(
    rows: ClippingRow[],
    includeOriginal: boolean,
  ): Promise<void> {
    const groups = groupRowsByBook(rows);
    if (groups.length === 0) return;
    const names = planBookFileNames(groups);
    const picked = await open({
      directory: true,
      multiple: false,
      title: t("export.folderPrompt"),
    });
    const folder = typeof picked === "string" ? picked : null;
    if (folder === null) return; // Cancelled: the dialog stays open.
    const existing = await invoke<string[]>("check_export_targets", { dir: folder, names });
    if (existing.length > 0) {
      const replace = await confirm(t("export.overwrite", { count: existing.length }), {
        title: t("export.title"),
        kind: "warning",
      });
      if (!replace) return;
    }
    const now = new Date();
    const files = groups.map((group, index) => ({
      name: names[index],
      contents: serializeBookMarkdown(group.rows, { includeOriginal, locale, t, now }),
    }));
    await invoke<number>("write_export_files", { dir: folder, files });
    logger.info(
      `export: wrote ${groups.length} per-book markdown files with ${rows.length} clippings to '${folder}'`,
    );
    exportStatus = t("export.doneFolder", {
      count: rows.length,
      books: groups.length,
      folder,
    });
    closeExport();
  }

  /** S4: filtered rows → serializer → native save dialog → Rust write. */
  async function onExport(
    format: ExportFormat,
    includeOriginal: boolean,
    perBook: boolean,
  ): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      const port = await getDb();
      const rows = await exportClippings(port, filter);
      if (format === "markdown" && perBook) {
        await exportOneFilePerBook(rows, includeOriginal);
        return;
      }
      const bookTitle = books.find((book) => book.id === filters.bookId)?.title ?? null;
      const fileName = exportFileName(format, bookTitle);
      const text =
        format === "markdown"
          ? serializeMarkdown(rows, { includeOriginal, locale, t })
          : format === "json"
            ? serializeJson(rows)
            : serializeCsv(rows);
      const extension = EXPORT_EXTENSIONS[format];
      let defaultPath = fileName;
      try {
        defaultPath = await invoke<string>("export_default_path", {
          suggestedFileName: fileName,
        });
      } catch {
        // Non-fatal: the bare file name is a valid default path.
      }
      const path = await save({
        defaultPath,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (path === null) return; // Cancelled: the dialog stays open.
      await invoke("write_export_file", { path, contents: text });
      logger.info(`export: wrote ${format} with ${rows.length} clippings`);
      exportStatus = t("export.done", { count: rows.length, file: fileName });
      closeExport();
    } catch (error) {
      exportStatus = t("export.error", {
        message: describeError(error),
      });
      logger.error("export", error);
    } finally {
      exporting = false;
    }
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

  /** Write a consistent SQLite snapshot (VACUUM INTO) to the picked path. */
  async function onBackup(): Promise<void> {
    if (backingUp) return;
    backingUp = true;
    backupStatus = t("backup.saving");
    try {
      const fileName = backupFileName();
      let defaultPath = fileName;
      try {
        defaultPath = await invoke<string>("export_default_path", {
          suggestedFileName: fileName,
        });
      } catch {
        // Non-fatal: the bare file name is a valid default path.
      }
      const path = await save({
        defaultPath,
        filters: [{ name: t("backup.filter"), extensions: [BACKUP_EXTENSION] }],
      });
      if (path === null) {
        backupStatus = null;
        return;
      }
      await invoke("clear_backup_target", { path });
      const port = await getDb();
      await port.execute("VACUUM INTO $1", [path]);
      logger.info(`backup: wrote ${baseName(path)}`);
      backupStatus = t("backup.done", { file: baseName(path) });
    } catch (error) {
      backupStatus = t("backup.error", {
        message: describeError(error),
      });
      logger.error("backup", error);
    } finally {
      backingUp = false;
    }
  }

  /**
   * Daily rotating snapshot: copy-only, one attempt per launch.
   *
   * The snapshot is written next to the live database with `VACUUM INTO` and
   * committed by Rust after checking the SQLite header, so a crash never
   * leaves a damaged file under a backup name. Failures are logged and never
   * interrupt startup (S7); retention runs only after a successful commit.
   */
  async function runAutoBackup(): Promise<void> {
    try {
      const finalName = backupFileName();
      const existing = await invoke<AutoBackup[]>("list_auto_backups");
      if (!autoBackupDue(existing.map((snapshot) => snapshot.name))) {
        logger.info("auto-backup: today's snapshot already exists");
        return;
      }

      const paths = await invoke<AutoBackupPaths>("prepare_auto_backup", { finalName });
      const port = await getDb();
      await port.execute("VACUUM INTO $1", [paths.tempPath]);
      await invoke("commit_auto_backup", {
        tempPath: paths.tempPath,
        finalPath: paths.finalPath,
      });
      logger.info(`auto-backup: wrote ${finalName}`);

      const snapshots = await invoke<AutoBackup[]>("list_auto_backups");
      const doomed = new Set(
        selectAutoBackupsToDelete(snapshots.map((snapshot) => snapshot.name)),
      );
      const candidates = snapshots
        .filter((snapshot) => doomed.has(snapshot.name))
        .map((snapshot) => snapshot.path);
      // Prune after every successful commit, even with nothing to delete:
      // the command also sweeps crash leftovers from earlier runs.
      const report = await invoke<AutoBackupPruneReport>("prune_auto_backups", {
        keep: AUTO_BACKUP_KEEP,
        candidates,
      });
      logger.info(
        `auto-backup: pruned ${report.deleted} snapshots (${report.failed} failed), ` +
          `removed ${report.tempsDeleted} stale temp files`,
      );
    } catch (error) {
      logger.error("auto-backup", error);
    }
  }

  /** Map a rejected snapshot to the reason shown in the restore dialog. */
  function restoreFailure(error: unknown): string {
    if (isBackupError(error)) {
      if (error.code === "not-kindclip") return t("restore.invalid");
      if (error.code === "newer-version") return t("restore.newer");
      return t("restore.corrupt", { message: error.message });
    }
    return t("restore.error", {
      message: describeError(error),
    });
  }

  /** Read the automatic snapshots each time the restore dialog opens. */
  async function loadAutoBackups(): Promise<void> {
    autoBackupsLoading = true;
    autoBackupsError = null;
    try {
      autoBackups = await invoke<AutoBackup[]>("list_auto_backups");
    } catch (error) {
      autoBackupsError = t("restore.listError", {
        message: describeError(error),
      });
      logger.error("restore-list", error);
    } finally {
      autoBackupsLoading = false;
    }
  }

  /** Open the restore dialog with the automatic snapshots listed. */
  function onRestoreRequest(): void {
    if (restoreBusy || backingUp) return;
    rememberOpener();
    restoreRequest += 1;
    restoreOpen = true;
    restorePath = null;
    restoreFile = "";
    restoreInfo = null;
    restoreError = null;
    restoreChecking = false;
    autoBackups = [];
    autoBackupsError = null;
    void loadAutoBackups();
  }

  /** Inspect one snapshot (automatic entry or picked file) before restoring. */
  async function inspectRestorePath(path: string): Promise<void> {
    const request = ++restoreRequest;
    restorePath = path;
    restoreFile = baseName(path);
    restoreInfo = null;
    restoreError = null;
    restoreChecking = true;
    try {
      const port = await getDb();
      const current = await schemaVersion(port);
      const info = await inspectBackupFile(path, current);
      if (request === restoreRequest) {
        restoreInfo = info;
      }
    } catch (error) {
      if (request === restoreRequest) {
        restoreError = restoreFailure(error);
      }
      logger.error("restore-inspect", error);
    } finally {
      if (request === restoreRequest) {
        restoreChecking = false;
      }
    }
  }

  /** Native file picker inside the dialog: the manual flow is unchanged. */
  async function chooseRestoreFile(): Promise<void> {
    if (restoreBusy || restoreChecking) return;
    let selected: string | null = null;
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: t("backup.filter"), extensions: [BACKUP_EXTENSION] }],
      });
      selected = typeof picked === "string" ? picked : null;
    } catch (error) {
      restoreError = t("restore.error", {
        message: describeError(error),
      });
      logger.error("restore-pick", error);
      return;
    }
    if (selected !== null) {
      await inspectRestorePath(selected);
    }
  }

  function closeRestore(): void {
    if (restoreBusy) return;
    restoreRequest += 1;
    restoreOpen = false;
    restoreChecking = false;
    restoreOpener();
  }

  /** Close the pool, replace the database file and let Rust restart the app. */
  async function confirmRestore(): Promise<void> {
    if (restorePath === null || restoreInfo === null || restoreBusy) return;
    restoreBusy = true;
    restoreError = null;
    try {
      await closeDb();
      await invoke("restore_database_file", { backupPath: restorePath });
      // Rust restarts the app on success and never returns; reaching this
      // point means the restart did not happen.
      logger.warn("restore: the app did not restart after a successful restore");
      restoreError = t("restore.restartFailed");
    } catch (error) {
      restoreError = t("restore.error", {
        message: describeError(error),
      });
      logger.error("restore", error);
      try {
        await getDb();
        await refreshAfterLibraryChange();
      } catch {
        // Keep the restore error on screen; the next launch retries the open.
      }
    } finally {
      restoreBusy = false;
    }
  }

  async function loadLibraryFiles(): Promise<void> {
    try {
      const port = await getDb();
      libraryFiles = await listImportedFiles(port);
    } catch (error) {
      libraryError = t("library.error", {
        message: describeError(error),
      });
      logger.error("library-load", error);
    }
  }

  async function openLibrary(): Promise<void> {
    rememberOpener();
    libraryStatus = null;
    libraryError = null;
    libraryOpen = true;
    await loadLibraryFiles();
  }

  /** Refresh every view the dialog can affect: books, list, imports and tags. */
  async function refreshAfterLibraryChange(): Promise<void> {
    await loadBooks();
    await loadList(filter, page, filters.pageSize, clippingSort);
    await loadLibraryFiles();
    const port = await getDb();
    allTags = await listTags(port);
  }

  /** One policy for library mutations: busy flag, translated error, and a
   * reload after a failure so a partially applied multi-step write shows the
   * real state instead of the pre-click one. */
  async function runLibraryAction<T>(action: (port: DbPort) => Promise<T>): Promise<T | null> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      return await action(port);
    } catch (error) {
      libraryError = t("library.error", { message: describeError(error) });
      await refreshAfterLibraryChange();
      return null;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryRename(
    bookId: number,
    title: string,
    author: string,
  ): Promise<RenameBookResult | null> {
    const result = await runLibraryAction((port) => renameBook(port, bookId, title, author));
    if (result?.status === "renamed") {
      libraryStatus = t("library.statusRenamed");
      await refreshAfterLibraryChange();
    }
    return result;
  }

  async function libraryMerge(sourceId: number, targetId: number): Promise<boolean> {
    const result = await runLibraryAction((port) => mergeBooks(port, sourceId, targetId));
    if (result?.status !== "merged") {
      return false;
    }
    libraryStatus = t("library.statusMerged", { count: result.moved });
    await refreshAfterLibraryChange();
    return true;
  }

  async function libraryDeleteBook(book: Book): Promise<boolean> {
    const removed = await runLibraryAction((port) => deleteBook(port, book.id));
    if (removed === null) {
      return false;
    }
    libraryStatus = t("library.statusDeleted", { count: removed });
    await refreshAfterLibraryChange();
    return true;
  }

  async function libraryRemoveFile(file: ImportedFile): Promise<boolean> {
    const result = await runLibraryAction((port) => removeImportedFile(port, file.id));
    if (result === null) {
      return false;
    }
    libraryStatus = t("library.statusRemoved", {
      clippings: result.clippings,
      books: result.books,
    });
    await refreshAfterLibraryChange();
    return true;
  }

  async function libraryRenameTag(
    tagId: number,
    name: string,
  ): Promise<RenameTagResult | null> {
    const result = await runLibraryAction((port) => renameTag(port, tagId, name));
    if (result?.status === "renamed") {
      libraryStatus = t("library.statusTagRenamed");
      await refreshAfterLibraryChange();
    }
    return result;
  }

  async function libraryMergeTags(sourceId: number, targetId: number): Promise<boolean> {
    const result = await runLibraryAction((port) => mergeTags(port, sourceId, targetId));
    if (result?.status !== "merged") {
      return false;
    }
    libraryStatus = t("library.statusTagsMerged", { count: result.moved });
    // The source tag is gone: it must leave the active filter too.
    filters.tagIds = withoutTagId(filters.tagIds, sourceId);
    await refreshAfterLibraryChange();
    return true;
  }

  async function libraryDeleteTag(tag: TagCount): Promise<boolean> {
    const done = await runLibraryAction(async (port) => {
      await deleteTag(port, tag.id);
      return true;
    });
    if (done === null) {
      return false;
    }
    libraryStatus = t("library.statusTagDeleted");
    // A deleted tag must leave the active filter too.
    filters.tagIds = withoutTagId(filters.tagIds, tag.id);
    await refreshAfterLibraryChange();
    return true;
  }

  const hasLibrary = $derived(books.length > 0);
  const libraryTotal = $derived(totalClippings(books));
  const sortedBooks = $derived(sortBooks(books, filters.bookSortBy, filters.bookSortDir));
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
    books.find((book) => book.id === filters.bookId)?.title ??
      (hasActiveFilters ? t("export.scopeFiltered") : t("export.scopeAll")),
  );
  /** Tooltip for the toolbar export button: what the next export would hold. */
  const exportSummary = $derived(
    t("export.summary", { count: result?.total ?? 0, scope: exportScope }),
  );
  /** Row shown full-window; null while the reading view is closed. */
  const readingClipping = $derived(reading ? readingCurrent(reading) : null);

  const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
    markdown: "md",
    json: "json",
    csv: "csv",
  };

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

  {#if loadError}
    <p class="border-b border-danger-border bg-danger-soft px-6 py-2 text-sm text-danger" role="alert">
      {loadError}
    </p>
  {/if}

  {#if !hasLibrary && !loading}
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
          disabled={importing}
          class="mt-4 rounded-full bg-inverse px-5 py-2 text-sm font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
        >
          {importing ? t("header.importing") : t("empty.cta")}
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
          importing={importing}
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
              disabled={!result || result.total === 0}
              title={exportSummary}
              aria-label={exportSummary}
              class="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            >
              <Icon name="export" />
            </button>
          </div>
        </div>

        {#if importStatus || exportStatus}
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-6 py-2 text-sm text-fg-muted"
            role="status"
          >
            {#if importStatus}
              <p class="min-w-0 truncate">{importStatus}</p>
            {/if}
            {#if exportStatus}
              <p class="min-w-0 truncate">{exportStatus}</p>
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
          class="flex-1 space-y-3 overflow-y-auto px-6 py-4 {loading ? 'opacity-50' : ''}"
        >
          {#if result && result.items.length > 0}
            {#each result.items as clipping (clipping.id)}
              <ClippingCard
                {clipping}
                {allTags}
                copied={copyFlash?.id === clipping.id && copyFlash.kind === "content"}
                quoted={copyFlash?.id === clipping.id && copyFlash.kind === "quote"}
                query={resultFilter.query}
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
          {:else if !loading}
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

        {#if result && result.total > 0}
          <div class="border-t border-line px-6 py-3">
            <Pagination
              page={result.page}
              total={result.total}
              pageSize={result.pageSize}
              onSelect={(next) => (page = next)}
              onSizeChange={changePageSize}
            />
          </div>
        {/if}
      </main>
    </div>
  {/if}
</div>

<svelte:window onkeydown={onWindowKeydown} />

{#if dragActive}
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

{#if reading && readingClipping}
  <ReadingView
    clipping={readingClipping}
    query={readingQuery}
    position={readingPosition(reading)}
    total={reading.total}
    canPrev={canStep(reading, "prev")}
    canNext={canStep(reading, "next")}
    loading={readingLoading}
    error={readingError}
    quoted={copyFlash?.id === readingClipping.id && copyFlash.kind === "quote"}
    onCopyQuote={copyReadingQuote}
    onPrev={() => void stepReading("prev")}
    onNext={() => void stepReading("next")}
    onClose={closeReading}
  />
{/if}

{#if statsOpen}
  <StatsDialog
    stats={statsData}
    loading={statsLoading}
    error={statsError}
    onClose={closeStats}
  />
{/if}

{#if resetTarget}
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
      {#if resetTarget.content}
        <blockquote
          class="mt-3 max-h-48 overflow-y-auto border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-fg"
        >
          {resetTarget.content}
        </blockquote>
      {:else}
        <p class="mt-3 text-sm text-fg-subtle italic">
          {t("card.noText", { kind: t(`kind.${resetTarget.kind}`) })}
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

{#if exportOpen}
  <ExportDialog
    count={result?.total ?? 0}
    scope={exportScope}
    busy={exporting}
    onClose={closeExport}
    onExport={onExport}
  />
{/if}

{#if libraryOpen}
  <LibraryDialog
    books={sortedBooks}
    files={libraryFiles}
    tags={allTags}
    busy={libraryBusy}
    status={libraryStatus}
    error={libraryError}
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

{#if restoreOpen}
  <RestoreDialog
    fileName={restoreFile}
    info={restoreInfo}
    checking={restoreChecking}
    busy={restoreBusy}
    error={restoreError}
    snapshots={autoBackups}
    snapshotsLoading={autoBackupsLoading}
    snapshotsError={autoBackupsError}
    onClose={closeRestore}
    onConfirm={confirmRestore}
    onChooseFile={chooseRestoreFile}
    onSelectSnapshot={inspectRestorePath}
  />
{/if}

{#if prefsOpen}
  <PreferencesDialog
    locale={locale}
    theme={themeMode}
    palette={darkPalette}
    font={fontScale}
    dbBusy={locatingDb}
    backingUp={backingUp}
    backupStatus={backupStatus}
    autoBackup={autoBackupEnabled}
    onLocale={setLocale}
    onTheme={setTheme}
    onPalette={setDarkPalette}
    onFont={setFontScale}
    onAutoBackup={setAutoBackup}
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
