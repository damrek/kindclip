<script lang="ts">
  import BookSidebar from "./components/BookSidebar.svelte";
  import ClippingCard from "./components/ClippingCard.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import FilterMenu from "./components/FilterMenu.svelte";
  import Icon from "./components/Icon.svelte";
  import LibraryDialog from "./components/LibraryDialog.svelte";
  import Pagination from "./components/Pagination.svelte";
  import PreferencesMenu from "./components/PreferencesMenu.svelte";
  import ReadingView from "./components/ReadingView.svelte";
  import RestoreDialog from "./components/RestoreDialog.svelte";
  import ShortcutsDialog from "./components/ShortcutsDialog.svelte";
  import StatsDialog from "./components/StatsDialog.svelte";
  import appIcon from "./assets/icon.png";
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
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
    applyThemeClass,
    loadThemeChoice,
    resolveTheme,
    saveThemeChoice,
    systemPrefersDark,
    type ThemeChoice,
  } from "./lib/theme";
  import {
    applyFontScale,
    loadFontScale,
    saveFontScale,
    type FontScale,
  } from "./lib/font";
  import { readSidebarOpen, saveSidebarOpen } from "./lib/sidebar";
  import {
    addClippingTag,
    closeDb,
    DEFAULT_CLIPPING_SORT,
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
    type ClippingSort,
    type ClippingSortDir,
    type ClippingSortKey,
    type ImportedFile,
    type RenameBookResult,
    type RenameTagResult,
    type StoredFilterState,
    type TagCount,
  } from "./lib/db";
  import { runImportFlow, pickDroppedFile, runImportFromPath, tauriImportDeps, type ImportDeps, type ImportOutcome } from "./lib/importer";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
  import {
    BACKUP_EXTENSION,
    backupFileName,
    baseName,
    inspectBackupFile,
    isBackupError,
    schemaVersion,
    type BackupInfo,
  } from "./lib/backup";
  import {
    exportFileName,
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
    sortBooks,
    totalClippings,
    withTag,
    withoutTag,
    withoutTagId,
    emptyFilter,
    type BookSortKey,
    type BookSortDir,
  } from "./lib/library";
  import {
    advanceReading,
    canStep,
    openReadingSession,
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

  let query = $state("");
  let debouncedQuery = $state("");
  let bookId = $state<number | null>(null);
  let kinds = $state<ClippingKind[]>([]);
  let favoritesOnly = $state(false);
  let editedOnly = $state(false);
  let tagIds = $state<number[]>([]);
  let sidebarOpen = $state(readSidebarOpen());
  let searchExpanded = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);
  let bookSortBy = $state<BookSortKey>("title");
  let bookSortDir = $state<BookSortDir>("asc");
  let sortBy = $state<ClippingSortKey>(DEFAULT_CLIPPING_SORT.key);
  let sortDir = $state<ClippingSortDir>(DEFAULT_CLIPPING_SORT.dir);
  let page = $state(1);
  let pageSize = $state(20);

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
  let copiedId = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Full-window reading session; null when closed. */
  let reading = $state<ReadingSession | null>(null);
  let readingLoading = $state(false);
  let readingError = $state<string | null>(null);
  /** Invalidates an in-flight page load when the session closes or restarts. */
  let readingRequest = 0;
  /** Filter/sort snapshot the reading window fetches adjacent pages with. */
  let readingSource = $state<{ filter: ClippingFilter; sort: ClippingSort } | null>(null);
  /** Element that opened the reading view; focus returns to it on close. */
  let readingOpener: HTMLElement | null = null;
  /** Scroller holding the cards; the focus fallback when the opener is gone. */
  let listRegion = $state<HTMLElement | null>(null);
  /** Card selected with j/k; the target of Enter, * and c. */
  let selectedId = $state<number | null>(null);
  let shortcutsOpen = $state(false);
  /** Controlled so App can close one overlay per Escape. */
  let filtersOpen = $state(false);
  let prefsOpen = $state(false);
  /** Element that opened the current modal; focus returns to it on close. */
  let modalOpener: HTMLElement | null = null;
  /** Note pending reset confirmation (dialog rendered at app root). */
  let resetTarget = $state<ClippingRow | null>(null);
  let locale = $state<Locale>(loadLocale(readStoredLocale()));
  let themeChoice = $state<ThemeChoice>(loadThemeChoice());
  let fontScale = $state<FontScale>(loadStoredFontScale());

  /** Reading view or a modal: the shell is inert and shortcuts are off. */
  const modalOpen = $derived(
    reading !== null ||
      resetTarget !== null ||
      exportOpen ||
      libraryOpen ||
      statsOpen ||
      restoreOpen ||
      shortcutsOpen,
  );
  const pages = $derived(Math.max(1, Math.ceil((result?.total ?? 0) / pageSize)));

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

  function setTheme(next: ThemeChoice): void {
    themeChoice = next;
    saveThemeChoice(next); // fast cache for the pre-paint script
    applyThemeClass(document.documentElement, resolveTheme(next, systemPrefersDark()));
    void persistSetting(SETTINGS_KEYS.theme, next);
  }

  function setFontScale(next: FontScale): void {
    fontScale = next;
    saveFontScale(next); // fast cache for the pre-paint script
    applyFontScale(document.documentElement, next);
    void persistSetting(SETTINGS_KEYS.fontScale, next);
  }

  /** Live system preference: the theme follows macOS while the choice is "system". */
  $effect(() => {
    const choice = themeChoice;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void =>
      applyThemeClass(document.documentElement, resolveTheme(choice, query.matches));
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
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

  const filter = $derived<ClippingFilter>({
    query: debouncedQuery,
    bookId,
    kinds,
    favoritesOnly,
    editedOnly,
    tagIds,
  });

  const clippingSort = $derived<ClippingSort>({ key: sortBy, dir: sortDir });

  const scheduleQuery = debounce((value: string) => {
    debouncedQuery = value;
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
      await getDb();
      const first = await listClippings(f, { page: p, pageSize: s }, sort);
      if (request !== listRequest) return; // Superseded by a newer filter or page.
      const last = clampPage(p, first.total, s);
      const next =
        last === p ? first : await listClippings(f, { page: last, pageSize: s }, sort);
      if (request !== listRequest) return;
      // Commit rows and the filter that produced them together: the reading
      // view must never fetch a page with a filter other than this one.
      result = next;
      resultFilter = { ...f, kinds: [...f.kinds], tagIds: [...f.tagIds] };
      resultSort = sort;
      page = last;
    } catch (error) {
      if (request === listRequest) {
        loadError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === listRequest) {
        loading = false;
      }
    }
  }

  async function loadBooks(): Promise<void> {
    try {
      await getDb();
      books = await listBooks();
      if (bookId !== null && !books.some((book) => book.id === bookId)) {
        // Persisted book gone (fresh DB, re-import, …): fall back to all.
        bookId = null;
        page = 1;
      }
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  /** Once on startup: DB is the source of truth, caches seed it on first run. */
  async function loadPreferences(): Promise<void> {
    try {
      const port = await getDb();
      const [dbLocale, dbTheme, dbFontScale, dbFilter, dbTags] = await Promise.all([
        getSetting(port, SETTINGS_KEYS.locale),
        getSetting(port, SETTINGS_KEYS.theme),
        getSetting(port, SETTINGS_KEYS.fontScale),
        loadFilterState(port),
        listTags(port),
      ]);
      allTags = dbTags;
      if (dbLocale && isLocale(dbLocale)) {
        locale = dbLocale;
      } else {
        await setSetting(port, SETTINGS_KEYS.locale, locale);
      }
      if (dbTheme === "light" || dbTheme === "dark" || dbTheme === "system") {
        themeChoice = dbTheme;
        saveThemeChoice(dbTheme);
        applyThemeClass(
          document.documentElement,
          resolveTheme(dbTheme, systemPrefersDark()),
        );
      } else {
        await setSetting(port, SETTINGS_KEYS.theme, themeChoice);
      }
      if (dbFontScale === "small" || dbFontScale === "medium" || dbFontScale === "large") {
        fontScale = dbFontScale;
        saveFontScale(dbFontScale);
        applyFontScale(document.documentElement, dbFontScale);
      } else {
        await setSetting(port, SETTINGS_KEYS.fontScale, fontScale);
      }
      if (dbFilter) {
        query = dbFilter.query;
        debouncedQuery = dbFilter.query;
        bookId = dbFilter.bookId;
        kinds = dbFilter.kinds;
        favoritesOnly = dbFilter.favoritesOnly;
        editedOnly = dbFilter.editedOnly;
        // Drop ids whose tag is gone (same guard as the book id).
        tagIds = (dbFilter.tagIds ?? []).filter((id) =>
          dbTags.some((tag) => tag.id === id),
        );
        pageSize = dbFilter.pageSize;
        bookSortBy = dbFilter.bookSortBy ?? "title";
        bookSortDir = dbFilter.bookSortDir ?? "asc";
        sortBy = dbFilter.sortBy ?? DEFAULT_CLIPPING_SORT.key;
        sortDir = dbFilter.sortDir ?? DEFAULT_CLIPPING_SORT.dir;
        page = 1;
      } else {
        await persistFilterState({
          query: debouncedQuery,
          bookId,
          kinds,
          favoritesOnly,
          editedOnly,
          tagIds,
          pageSize,
          bookSortBy,
          bookSortDir,
          sortBy,
          sortDir,
        });
      }
    } catch {
      // Non-fatal: the app works with defaults and in-memory filters.
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
    scheduleQuery(query);
  });

  // NOTE: $effect only tracks state read SYNCHRONOUSLY in its body.
  // loadList reads filter/page/pageSize after an await, so they must be
  // passed as arguments here — otherwise the list loads once on mount
  // and filters/pagination/sidebar silently stop working.
  //
  // Waiting for prefsReady keeps the first load from running with the empty
  // default filter: the stored kinds must be applied first, or a list saved
  // as notes + highlights flashes every kind (bookmarks included) and a slow
  // cold start can leave that unfiltered page on screen.
  $effect(() => {
    if (!prefsReady) return;
    void loadList(filter, page, pageSize, clippingSort);
  });

  $effect(() => {
    void loadBooks();
  });

  $effect(() => {
    void loadPreferences();
  });

  // Snapshot passed synchronously (see the loadList NOTE above): the debounced
  // write itself runs outside tracking, but the state snapshot is captured here.
  // Gated until the stored filter is applied, so the defaults are never written
  // over a filter the user already saved.
  $effect(() => {
    if (!prefsReady) return;
    saveFilters({
      query: debouncedQuery,
      bookId,
      kinds,
      favoritesOnly,
      editedOnly,
      tagIds,
      pageSize,
      bookSortBy,
      bookSortDir,
      sortBy,
      sortDir,
    });
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
    bookId = id;
    page = 1;
  }

  function setBookSortBy(key: BookSortKey): void {
    bookSortBy = key;
  }

  function toggleBookSortDir(): void {
    bookSortDir = bookSortDir === "asc" ? "desc" : "asc";
  }

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
    saveSidebarOpen(sidebarOpen);
  }

  async function openSearch(): Promise<void> {
    searchExpanded = true;
    await tick();
    searchInput?.focus();
  }

  /** Escape clears the query first, then folds the field away. */
  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The window handler closes overlays; the field owns this Escape.
    event.preventDefault();
    event.stopPropagation();
    if (query !== "") {
      query = "";
      return;
    }
    searchExpanded = false;
    (event.currentTarget as HTMLInputElement).blur();
  }

  function onSearchBlur(): void {
    if (query === "") searchExpanded = false;
  }

  function clearSearch(): void {
    query = "";
    searchExpanded = false;
  }

  function toggleKind(next: ClippingKind): void {
    kinds = kinds.includes(next) ? kinds.filter((kind) => kind !== next) : [...kinds, next];
    page = 1;
  }

  function toggleFavoritesOnly(): void {
    favoritesOnly = !favoritesOnly;
    page = 1;
  }

  function toggleEditedOnly(): void {
    editedOnly = !editedOnly;
    page = 1;
  }

  /** Toggle one tag in the AND filter (S4); the list reloads from `filter`. */
  function toggleTag(id: number): void {
    tagIds = tagIds.includes(id)
      ? tagIds.filter((tagId) => tagId !== id)
      : [...tagIds, id];
    page = 1;
  }

  /** Value shape of the sort select: `<key>:<dir>` (e.g. `page:asc`). */
  function setClippingSort(value: string): void {
    const [key, dir] = value.split(":");
    if (key !== "date" && key !== "title" && key !== "page") return;
    if (dir !== "asc" && dir !== "desc") return;
    sortBy = key;
    sortDir = dir;
    page = 1;
  }

  async function copyContent(id: number): Promise<void> {
    const target = result?.items.find((item) => item.id === id);
    const text = target ? (target.content_edited ?? target.content) : null;
    if (!text) return;
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    const ok = await copyClippingContent(writeText, text);
    if (ok) {
      copiedId = id;
      if (copyTimer !== null) {
        clearTimeout(copyTimer);
      }
      copyTimer = setTimeout(() => {
        copiedId = null;
        copyTimer = null;
      }, 1500);
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
      if (favoritesOnly && !confirmed) {
        // The unstarred card no longer belongs to this view.
        await loadList(filter, page, pageSize, clippingSort);
      }
    } catch (error) {
      result = { ...result, items: applyFavoriteToggle(result.items, id, current.favorite) };
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  function changePageSize(size: number): void {
    pageSize = size;
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
      loadError = error instanceof Error ? error.message : String(error);
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
      if (tagIds.includes(tagId)) {
        // The card no longer carries every selected tag.
        await loadList(filter, page, pageSize, clippingSort);
      }
      return true;
    } catch (error) {
      patchClippingTags(id, () => before);
      loadError = error instanceof Error ? error.message : String(error);
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
      loadError = error instanceof Error ? error.message : String(error);
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
        if (editedOnly) {
          // The reset note no longer belongs to this view.
          await loadList(filter, page, pageSize, clippingSort);
        }
      }
      return confirmed;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
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

  /** Open the full-window reading view on one visible row. */
  function startReading(id: number): void {
    if (!result) return;
    const session = openReadingSession(result, id);
    if (!session) return;
    readingRequest += 1;
    readingError = null;
    readingLoading = false;
    // The window holds rows from the filter on screen; keep that exact filter
    // for the adjacent pages, not the live one, which may already differ while
    // a search or page load is in flight.
    readingSource = { filter: resultFilter, sort: resultSort };
    readingOpener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reading = session;
  }

  /** Close and leave the list on the page where reading stopped. */
  async function closeReading(): Promise<void> {
    if (!reading) return;
    const targetPage = readingPage(reading);
    const opener = readingOpener;
    readingRequest += 1;
    reading = null;
    readingLoading = false;
    readingError = null;
    readingSource = null;
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

  /** Remember where focus was before a modal opened. */
  function rememberOpener(): void {
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
          message: error instanceof Error ? error.message : String(error),
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
        prefsOpen = true;
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
      if (filtersOpen) {
        event.preventDefault();
        filtersOpen = false;
        return;
      }
      if (prefsOpen) {
        event.preventDefault();
        prefsOpen = false;
        return;
      }
      if (query !== "") {
        event.preventDefault();
        query = "";
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
      overlay: modalOpen || filtersOpen || prefsOpen,
      hasLibrary,
      hasResults: (result?.items.length ?? 0) > 0,
      hasSelection: selectedId !== null,
      canPrevPage: page > 1,
      canNextPage: page < pages,
    });
    if (action === null) return;
    event.preventDefault();
    runShortcut(action);
  }

  /** Step one row; fetch the adjacent page only when the window runs out. */
  async function stepReading(dir: ReadingDirection): Promise<void> {
    const session = reading;
    const source = readingSource;
    if (!session || !source || readingLoading) return;
    const moved = stepWithinWindow(session, dir);
    if (moved) {
      // A successful step dismisses a banner left over from a failed fetch.
      readingError = null;
      reading = moved;
      return;
    }
    if (pageToLoad(session, dir) === null) return;
    const request = ++readingRequest;
    readingLoading = true;
    readingError = null;
    try {
      const next = await advanceReading(session, dir, (page, pageSize) =>
        listClippings(source.filter, { page, pageSize }, source.sort),
      );
      if (request !== readingRequest) return; // Closed or reopened while loading.
      reading = next;
    } catch (error) {
      if (request === readingRequest) {
        readingError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      // Replacing the session on success must still release the busy flag.
      if (request === readingRequest) {
        readingLoading = false;
      }
    }
  }

  function clearFilters(): void {
    query = "";
    debouncedQuery = "";
    favoritesOnly = false;
    editedOnly = false;
    kinds = [];
    tagIds = [];
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
      } else {
        const report = outcome.report;
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
        await loadList(filter, 1, pageSize, clippingSort);
      }
    } catch (error) {
      importStatus = t("import.error", {
        message: error instanceof Error ? error.message : String(error),
      });
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

  /** S4: filtered rows → serializer → native save dialog → Rust write. */
  async function onExport(format: ExportFormat, includeOriginal: boolean): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      const rows = await exportClippings(filter);
      const bookTitle = books.find((book) => book.id === bookId)?.title ?? null;
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
      exportStatus = t("export.done", { count: rows.length, file: fileName });
      closeExport();
    } catch (error) {
      exportStatus = t("export.error", {
        message: error instanceof Error ? error.message : String(error),
      });
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
        message: error instanceof Error ? error.message : String(error),
      });
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
      backupStatus = t("backup.done", { file: baseName(path) });
    } catch (error) {
      backupStatus = t("backup.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      backingUp = false;
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
      message: error instanceof Error ? error.message : String(error),
    });
  }

  /** Pick a snapshot, open it apart from the live DB and show what it holds. */
  async function onRestoreRequest(): Promise<void> {
    if (restoreBusy || backingUp) return;
    rememberOpener();

    let selected: string | null = null;
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: t("backup.filter"), extensions: [BACKUP_EXTENSION] }],
      });
      selected = typeof picked === "string" ? picked : null;
    } catch (error) {
      restorePath = null;
      restoreFile = "";
      restoreInfo = null;
      restoreChecking = false;
      restoreError = t("restore.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      restoreOpen = true;
      return;
    }
    if (selected === null) return;

    const request = ++restoreRequest;
    restorePath = selected;
    restoreFile = baseName(selected);
    restoreInfo = null;
    restoreError = null;
    restoreChecking = true;
    restoreOpen = true;
    try {
      const port = await getDb();
      const current = await schemaVersion(port);
      const info = await inspectBackupFile(selected, current);
      if (request === restoreRequest) {
        restoreInfo = info;
      }
    } catch (error) {
      if (request === restoreRequest) {
        restoreError = restoreFailure(error);
      }
    } finally {
      if (request === restoreRequest) {
        restoreChecking = false;
      }
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
      restoreError = t("restore.restartFailed");
    } catch (error) {
      restoreError = t("restore.error", {
        message: error instanceof Error ? error.message : String(error),
      });
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
        message: error instanceof Error ? error.message : String(error),
      });
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
    await loadList(filter, page, pageSize, clippingSort);
    await loadLibraryFiles();
    const port = await getDb();
    allTags = await listTags(port);
  }

  async function libraryRename(
    bookId: number,
    title: string,
    author: string,
  ): Promise<RenameBookResult | null> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const result = await renameBook(port, bookId, title, author);
      if (result.status === "renamed") {
        libraryStatus = t("library.statusRenamed");
        await refreshAfterLibraryChange();
      }
      return result;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryMerge(sourceId: number, targetId: number): Promise<boolean> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const result = await mergeBooks(port, sourceId, targetId);
      if (result.status !== "merged") {
        return false;
      }
      libraryStatus = t("library.statusMerged", { count: result.moved });
      await refreshAfterLibraryChange();
      return true;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryDeleteBook(book: Book): Promise<boolean> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const removed = await deleteBook(port, book.id);
      libraryStatus = t("library.statusDeleted", { count: removed });
      await refreshAfterLibraryChange();
      return true;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryRemoveFile(file: ImportedFile): Promise<boolean> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const result = await removeImportedFile(port, file.id);
      libraryStatus = t("library.statusRemoved", {
        clippings: result.clippings,
        books: result.books,
      });
      await refreshAfterLibraryChange();
      return true;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryRenameTag(
    tagId: number,
    name: string,
  ): Promise<RenameTagResult | null> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const result = await renameTag(port, tagId, name);
      if (result.status === "renamed") {
        libraryStatus = t("library.statusTagRenamed");
        await refreshAfterLibraryChange();
      }
      return result;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryMergeTags(sourceId: number, targetId: number): Promise<boolean> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      const result = await mergeTags(port, sourceId, targetId);
      if (result.status !== "merged") {
        return false;
      }
      libraryStatus = t("library.statusTagsMerged", { count: result.moved });
      // The source tag is gone: it must leave the active filter too.
      tagIds = withoutTagId(tagIds, sourceId);
      await refreshAfterLibraryChange();
      return true;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      libraryBusy = false;
    }
  }

  async function libraryDeleteTag(tag: TagCount): Promise<boolean> {
    libraryBusy = true;
    libraryError = null;
    try {
      const port = await getDb();
      await deleteTag(port, tag.id);
      libraryStatus = t("library.statusTagDeleted");
      // A deleted tag must leave the active filter too.
      tagIds = withoutTagId(tagIds, tag.id);
      await refreshAfterLibraryChange();
      return true;
    } catch (error) {
      libraryError = t("library.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      libraryBusy = false;
    }
  }

  const hasLibrary = $derived(books.length > 0);
  const libraryTotal = $derived(totalClippings(books));
  const sortedBooks = $derived(sortBooks(books, bookSortBy, bookSortDir));
  const hasActiveFilters = $derived(
    debouncedQuery.trim() !== "" ||
      bookId !== null ||
      kinds.length > 0 ||
      favoritesOnly ||
      editedOnly ||
      tagIds.length > 0,
  );
  /** Dialog scope: selected book title, else which view is being exported. */
  const exportScope = $derived(
    books.find((book) => book.id === bookId)?.title ??
      (hasActiveFilters ? t("export.scopeFiltered") : t("export.scopeAll")),
  );
  /** Row shown full-window; null while the reading view is closed. */
  const readingClipping = $derived(reading ? readingCurrent(reading) : null);

  const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
    markdown: "md",
    json: "json",
    csv: "csv",
  };

  /** Selected tags in selection order, for the removable chips under the bar. */
  const selectedTags = $derived(
    tagIds.flatMap((id) => {
      const tag = allTags.find((item) => item.id === id);
      return tag ? [tag] : [];
    }),
  );
  /** Filter checklist: orphans stay hidden unless already selected (S5). */
  const filterTags = $derived(
    allTags.filter((tag) => tag.clipping_count > 0 || tagIds.includes(tag.id)),
  );

  interface ActiveFilterChip {
    key: string;
    label: string;
    remove: () => void;
  }

  /** Every active filter is visible and removable in the chip row, not just tags. */
  const activeChips = $derived.by((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];
    for (const kind of kinds) {
      chips.push({
        key: `kind:${kind}`,
        label: t(`kind.${kind}`),
        remove: () => toggleKind(kind),
      });
    }
    if (favoritesOnly) {
      chips.push({ key: "favorites", label: t("fav.toggle"), remove: toggleFavoritesOnly });
    }
    if (editedOnly) {
      chips.push({ key: "edited", label: t("edit.toggle"), remove: toggleEditedOnly });
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
    class="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800"
  >
    <div class="flex min-w-0 items-center gap-2">
      {#if hasLibrary}
        <button
          type="button"
          onclick={toggleSidebar}
          aria-label={t("sidebar.toggle")}
          aria-expanded={sidebarOpen}
          aria-controls="book-sidebar"
          title={t("sidebar.toggle")}
          class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Icon name="sidebar" />
        </button>
      {/if}
      <h1 class="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
        <img src={appIcon} alt="" width="24" height="24" class="h-6 w-6 rounded-[6px]" />
        kindclip
      </h1>
    </div>
    <div class="flex min-w-0 items-center gap-1">
      {#if importStatus}
        <p class="truncate text-sm text-neutral-500 dark:text-neutral-400" role="status">
          {importStatus}
        </p>
      {/if}
      {#if exportStatus}
        <p class="truncate text-sm text-neutral-500 dark:text-neutral-400" role="status">
          {exportStatus}
        </p>
      {/if}
      <button
        type="button"
        onclick={openStats}
        disabled={!hasLibrary}
        title={t("stats.open")}
        aria-label={t("stats.open")}
        class="rounded-full px-2.5 py-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Icon name="stats" />
      </button>
      <button
        type="button"
        onclick={openLibrary}
        disabled={!hasLibrary}
        title={t("library.open")}
        aria-label={t("library.open")}
        class="rounded-full px-2.5 py-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Icon name="library" />
      </button>
      <button
        type="button"
        onclick={openExport}
        disabled={!result || result.total === 0}
        title={t("export.button")}
        aria-label={t("export.button")}
        class="rounded-full px-2.5 py-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Icon name="export" />
      </button>
      <button
        type="button"
        onclick={onImport}
        disabled={importing}
        class="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {importing ? t("header.importing") : t("header.import")}
      </button>
      <PreferencesMenu
        bind:open={prefsOpen}
        locale={locale}
        theme={themeChoice}
        font={fontScale}
        dbBusy={locatingDb}
        backingUp={backingUp}
        backupStatus={backupStatus}
        onLocale={setLocale}
        onTheme={setTheme}
        onFont={setFontScale}
        onOpenDb={onOpenDbLocation}
        onBackup={onBackup}
        onRestore={onRestoreRequest}
        onShortcuts={openShortcuts}
      />
    </div>
  </header>

  {#if loadError}
    <p class="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
      {loadError}
    </p>
  {/if}

  {#if !hasLibrary && !loading}
    <main class="flex flex-1 items-center justify-center px-6">
      <div class="max-w-sm text-center">
        <div
          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl dark:bg-amber-950"
          aria-hidden="true"
        >
          &#10077;
        </div>
        <h2 class="text-base font-medium">{t("empty.title")}</h2>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t("empty.body")}
        </p>
        <button
          type="button"
          onclick={onImport}
          disabled={importing}
          class="mt-4 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
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
        class="absolute inset-y-0 left-0 z-30 w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3 shadow-xl md:static md:z-auto md:bg-transparent md:shadow-none dark:border-neutral-800 dark:bg-neutral-950 md:dark:bg-transparent {sidebarOpen
          ? ''
          : 'hidden'}"
      >
        <BookSidebar
          books={sortedBooks}
          selectedId={bookId}
          totalCount={libraryTotal}
          onSelect={selectBook}
          sortBy={bookSortBy}
          sortDir={bookSortDir}
          onSortBy={setBookSortBy}
          onSortDirToggle={toggleBookSortDir}
        />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
        >
          <div class="flex min-w-0 flex-1 items-center">
            {#if searchExpanded || query !== ""}
              <div class="relative w-full max-w-sm">
                <span
                  class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400"
                  aria-hidden="true"
                >
                  <Icon name="search" class="h-4 w-4" />
                </span>
                <input
                  bind:this={searchInput}
                  type="search"
                  bind:value={query}
                  onkeydown={onSearchKeydown}
                  onblur={onSearchBlur}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.placeholder")}
                  class="w-full rounded-full border border-neutral-200 bg-neutral-50 py-2 pr-8 pl-9 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
                />
                {#if query !== ""}
                  <button
                    type="button"
                    onclick={clearSearch}
                    aria-label={t("search.clear")}
                    class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
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
                class="rounded-full px-2.5 py-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <Icon name="search" />
              </button>
            {/if}
          </div>

          <FilterMenu
            bind:open={filtersOpen}
            {kinds}
            {favoritesOnly}
            {editedOnly}
            {tagIds}
            tags={filterTags}
            onToggleKind={toggleKind}
            onToggleFavorites={toggleFavoritesOnly}
            onToggleEdited={toggleEditedOnly}
            onToggleTag={toggleTag}
            onClear={clearFilters}
          />

          <label class="ml-auto">
            <span class="sr-only">{t("clippingSort.label")}</span>
            <select
              value={`${sortBy}:${sortDir}`}
              onchange={(event) => setClippingSort(event.currentTarget.value)}
              aria-label={t("clippingSort.label")}
              class="cursor-pointer rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-500"
            >
              <option value="date:desc">{t("clippingSort.dateDesc")}</option>
              <option value="date:asc">{t("clippingSort.dateAsc")}</option>
              <option value="title:asc">{t("clippingSort.titleAsc")}</option>
              <option value="title:desc">{t("clippingSort.titleDesc")}</option>
              <option value="page:asc">{t("clippingSort.pageAsc")}</option>
              <option value="page:desc">{t("clippingSort.pageDesc")}</option>
            </select>
          </label>
        </div>

        {#if activeChips.length > 0}
          <div
            class="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 px-6 py-2 dark:border-neutral-800"
          >
            {#each activeChips as chip (chip.key)}
              <span
                class="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onclick={chip.remove}
                  aria-label={t("filters.remove", { name: chip.label })}
                  title={t("filters.remove", { name: chip.label })}
                  class="-mr-0.5 rounded-full px-0.5 text-sm leading-none text-neutral-400 transition hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
                >
                  ×
                </button>
              </span>
            {/each}
            <button
              type="button"
              onclick={clearFilters}
              class="ml-1 text-xs font-medium text-neutral-500 underline-offset-2 transition hover:text-neutral-800 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
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
                copied={clipping.id === copiedId}
                query={resultFilter.query}
                onSelect={(id) => (selectedId = id)}
                onOpen={startReading}
                onToggleFavorite={toggleStar}
                onCopy={copyContent}
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
              <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
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
                  class="mt-4 rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {t("results.clear")}
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if result && result.total > 0}
          <div class="border-t border-neutral-200 px-6 py-3 dark:border-neutral-800">
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
      class="absolute inset-4 rounded-3xl border-2 border-dashed border-amber-400 bg-amber-50/90 dark:border-amber-500 dark:bg-neutral-900/90"
    ></div>
    <div class="relative text-center">
      <p class="text-lg font-medium">{t("drop.title")}</p>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("drop.body")}</p>
    </div>
  </div>
{/if}

{#if reading && readingClipping}
  <ReadingView
    clipping={readingClipping}
    query={readingSource?.filter.query ?? ""}
    position={readingPosition(reading)}
    total={reading.total}
    canPrev={canStep(reading, "prev")}
    canNext={canStep(reading, "next")}
    loading={readingLoading}
    error={readingError}
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
      class="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {t("card.reset")}
      </p>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {t("card.resetConfirm")}
      </p>
      {#if resetTarget.content}
        <blockquote
          class="mt-3 max-h-48 overflow-y-auto border-l-2 border-amber-400 pl-4 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200"
        >
          {resetTarget.content}
        </blockquote>
      {:else}
        <p class="mt-3 text-sm text-neutral-400 italic dark:text-neutral-500">
          {t("card.noText", { kind: t(`kind.${resetTarget.kind}`) })}
        </p>
      {/if}
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onclick={closeReset}
          class="rounded-full border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("card.cancel")}
        </button>
        <button
          type="button"
          onclick={confirmResetDialog}
          class="rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
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
    onClose={closeRestore}
    onConfirm={confirmRestore}
  />
{/if}

{#if shortcutsOpen}
  <ShortcutsDialog onClose={closeShortcuts} />
{/if}
