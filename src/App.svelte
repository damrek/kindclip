<script lang="ts">
  import BookSidebar from "./components/BookSidebar.svelte";
  import ClippingCard from "./components/ClippingCard.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import FilterMenu from "./components/FilterMenu.svelte";
  import Icon from "./components/Icon.svelte";
  import LibraryDialog from "./components/LibraryDialog.svelte";
  import Pagination from "./components/Pagination.svelte";
  import PreferencesMenu from "./components/PreferencesMenu.svelte";
  import appIcon from "./assets/icon.png";
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
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
  import { runImportFlow, tauriImportDeps } from "./lib/importer";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
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
    type BookSortKey,
    type BookSortDir,
  } from "./lib/library";
  import type {
    Book,
    ClippingFilter,
    ClippingKind,
    ClippingRow,
    PagedResult,
    Tag,
  } from "./lib/types";

  let books = $state<Book[]>([]);
  let allTags = $state<TagCount[]>([]);
  let result = $state<PagedResult<ClippingRow> | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

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
  let locatingDb = $state(false);
  let importStatus = $state<string | null>(null);
  let exportOpen = $state(false);
  let exporting = $state(false);
  let exportStatus = $state<string | null>(null);
  let libraryOpen = $state(false);
  let libraryBusy = $state(false);
  let libraryFiles = $state<ImportedFile[]>([]);
  let libraryStatus = $state<string | null>(null);
  let libraryError = $state<string | null>(null);
  let copiedId = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Note pending reset confirmation (dialog rendered at app root). */
  let resetTarget = $state<ClippingRow | null>(null);
  let locale = $state<Locale>(loadLocale(readStoredLocale()));
  let themeChoice = $state<ThemeChoice>(loadThemeChoice());
  let fontScale = $state<FontScale>(loadStoredFontScale());

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
    loading = true;
    loadError = null;
    try {
      await getDb();
      const first = await listClippings(f, { page: p, pageSize: s }, sort);
      const last = clampPage(p, first.total, s);
      result =
        last === p ? first : await listClippings(f, { page: last, pageSize: s }, sort);
      page = last;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
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
  $effect(() => {
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
  $effect(() => {
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
    resetTarget = result?.items.find((item) => item.id === id) ?? null;
  }

  async function confirmResetDialog(): Promise<void> {
    if (!resetTarget) return;
    if (await resetNoteToOriginal(resetTarget.id)) {
      resetTarget = null;
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

  async function onImport(): Promise<void> {
    if (importing) return;
    importing = true;
    importStatus = t("import.reading");
    try {
      const outcome = await runImportFlow(tauriImportDeps(), (done, total) => {
        importStatus = t("import.progress", { done, total });
      });
      if (outcome.status === "cancelled") {
        importStatus = null;
      } else if (outcome.status === "empty") {
        importStatus = t("import.empty", { path: outcome.path });
      } else {
        const report = outcome.report;
        importStatus = report.alreadyImported
          ? t("import.duplicate")
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

  /** Open the export dialog from the header (clears the previous outcome). */
  function openExport(): void {
    if (!result || result.total === 0) return;
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
      exportOpen = false;
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

<div class="flex h-full flex-col">
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
        locale={locale}
        theme={themeChoice}
        font={fontScale}
        dbBusy={locatingDb}
        onLocale={setLocale}
        onTheme={setTheme}
        onFont={setFontScale}
        onOpenDb={onOpenDbLocation}
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

        <div class="flex-1 space-y-3 overflow-y-auto px-6 py-4 {loading ? 'opacity-50' : ''}">
          {#if result && result.items.length > 0}
            {#each result.items as clipping (clipping.id)}
              <ClippingCard
                {clipping}
                {allTags}
                copied={clipping.id === copiedId}
                onToggleFavorite={toggleStar}
                onCopy={copyContent}
                onEdit={editNote}
                onRequestReset={requestReset}
                onAddTag={addTagToClipping}
                onRemoveTag={removeTagFromClipping}
                onFilterByTag={toggleTag}
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

<svelte:window
  onkeydown={(event) => {
    if (resetTarget && event.key === "Escape") resetTarget = null;
    if (exportOpen && !exporting && event.key === "Escape") exportOpen = false;
    if (libraryOpen && !libraryBusy && event.key === "Escape") libraryOpen = false;
  }}
/>

{#if resetTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      aria-label={t("card.cancel")}
      onclick={() => (resetTarget = null)}
      class="absolute inset-0 cursor-default bg-black/50"
    ></button>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("card.reset")}
      tabindex={-1}
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
          onclick={() => (resetTarget = null)}
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
    onClose={() => (exportOpen = false)}
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
    onClose={() => (libraryOpen = false)}
    onRename={libraryRename}
    onMerge={libraryMerge}
    onDeleteBook={libraryDeleteBook}
    onRemoveFile={libraryRemoveFile}
    onRenameTag={libraryRenameTag}
    onMergeTags={libraryMergeTags}
    onDeleteTag={libraryDeleteTag}
  />
{/if}
