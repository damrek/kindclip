<script lang="ts">
  import BookSidebar from "./components/BookSidebar.svelte";
  import ClippingCard from "./components/ClippingCard.svelte";
  import FontScaleToggle from "./components/FontScaleToggle.svelte";
  import LanguageSelector from "./components/LanguageSelector.svelte";
  import Pagination from "./components/Pagination.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import appIcon from "./assets/icon.png";
  import { setContext } from "svelte";
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
    nextTheme,
    resolveTheme,
    saveThemeChoice,
    systemPrefersDark,
    type ThemeChoice,
  } from "./lib/theme";
  import {
    applyFontScale,
    loadFontScale,
    nextFontScale,
    saveFontScale,
    type FontScale,
  } from "./lib/font";
  import {
    getDb,
    getSetting,
    listBooks,
    listClippings,
    loadFilterState,
    setSetting,
    SETTINGS_KEYS,
    toggleFavorite,
    type StoredFilterState,
  } from "./lib/db";
  import { runImportFlow, tauriImportDeps } from "./lib/importer";
  import { revealDbLocation, tauriDbLocationDeps } from "./lib/db-location";
  import {
    applyFavoriteToggle,
    clampPage,
    copyClippingContent,
    debounce,
    totalClippings,
  } from "./lib/library";
  import type {
    Book,
    ClippingFilter,
    ClippingKind,
    ClippingRow,
    PagedResult,
  } from "./lib/types";

  let books = $state<Book[]>([]);
  let result = $state<PagedResult<ClippingRow> | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  let query = $state("");
  let debouncedQuery = $state("");
  let bookId = $state<number | null>(null);
  let kinds = $state<ClippingKind[]>([]);
  let favoritesOnly = $state(false);
  let page = $state(1);
  let pageSize = $state(20);

  let importing = $state(false);
  let locatingDb = $state(false);
  let importStatus = $state<string | null>(null);
  let copiedId = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
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

  function cycleTheme(): void {
    const next = nextTheme(themeChoice);
    themeChoice = next;
    saveThemeChoice(next); // fast cache for the pre-paint script
    applyThemeClass(document.documentElement, resolveTheme(next, systemPrefersDark()));
    void persistSetting(SETTINGS_KEYS.theme, next);
  }

  function cycleFontScale(): void {
    const next = nextFontScale(fontScale);
    fontScale = next;
    saveFontScale(next); // fast cache for the pre-paint script
    applyFontScale(document.documentElement, next);
    void persistSetting(SETTINGS_KEYS.fontScale, next);
  }

  setContext<I18nContext>(I18N_CONTEXT_KEY, {
    get locale() {
      return locale;
    },
    t,
    setLocale,
  });

  const filter = $derived<ClippingFilter>({ query: debouncedQuery, bookId, kinds, favoritesOnly });

  const scheduleQuery = debounce((value: string) => {
    debouncedQuery = value;
    page = 1;
  }, 250);

  async function loadList(f: ClippingFilter, p: number, s: number): Promise<void> {
    loading = true;
    loadError = null;
    try {
      await getDb();
      const first = await listClippings(f, { page: p, pageSize: s });
      const last = clampPage(p, first.total, s);
      result = last === p ? first : await listClippings(f, { page: last, pageSize: s });
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
      const [dbLocale, dbTheme, dbFontScale, dbFilter] = await Promise.all([
        getSetting(port, SETTINGS_KEYS.locale),
        getSetting(port, SETTINGS_KEYS.theme),
        getSetting(port, SETTINGS_KEYS.fontScale),
        loadFilterState(port),
      ]);
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
        pageSize = dbFilter.pageSize;
        page = 1;
      } else {
        await persistFilterState({
          query: debouncedQuery,
          bookId,
          kinds,
          favoritesOnly,
          pageSize,
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
    void loadList(filter, page, pageSize);
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
    saveFilters({ query: debouncedQuery, bookId, kinds, favoritesOnly, pageSize });
  });

  $effect(() => {
    document.documentElement.lang = locale;
  });

  function selectBook(id: number | null): void {
    bookId = id;
    page = 1;
  }

  function toggleKind(next: ClippingKind): void {
    kinds = kinds.includes(next) ? kinds.filter((kind) => kind !== next) : [...kinds, next];
    page = 1;
  }

  function toggleFavoritesOnly(): void {
    favoritesOnly = !favoritesOnly;
    page = 1;
  }

  async function copyContent(id: number): Promise<void> {
    const target = result?.items.find((item) => item.id === id);
    if (!target?.content) return;
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    const ok = await copyClippingContent(writeText, target.content);
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
        await loadList(filter, page, pageSize);
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

  function clearFilters(): void {
    query = "";
    debouncedQuery = "";
    favoritesOnly = false;
    kinds = [];
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
        await loadList(filter, 1, pageSize);
      }
    } catch (error) {
      importStatus = t("import.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      importing = false;
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

  const hasLibrary = $derived(books.length > 0);
  const libraryTotal = $derived(totalClippings(books));
  const hasActiveFilters = $derived(
    debouncedQuery.trim() !== "" || bookId !== null || kinds.length > 0 || favoritesOnly,
  );

  const KIND_OPTIONS: ClippingKind[] = ["highlight", "note", "bookmark"];
</script>

<div class="flex h-full flex-col">
  <header
    class="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
  >
    <h1 class="flex items-center gap-2 text-base font-semibold tracking-tight">
      <img src={appIcon} alt="" width="24" height="24" class="h-6 w-6 rounded-[6px]" />
      kindclip
    </h1>
    <div class="flex items-center gap-1">
      <LanguageSelector />
      <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
      <FontScaleToggle scale={fontScale} onCycle={cycleFontScale} />
      {#if importStatus}
        <p class="text-sm text-neutral-500 dark:text-neutral-400" role="status">{importStatus}</p>
      {/if}
      <button
        type="button"
        onclick={onOpenDbLocation}
        disabled={locatingDb}
        title={t("db.open")}
        aria-label={t("db.open")}
        class="rounded-full px-2.5 py-1.5 text-base leading-none text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        📁
      </button>
      <button
        type="button"
        onclick={onImport}
        disabled={importing}
        class="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {importing ? t("header.importing") : t("header.import")}
      </button>
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
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-64 shrink-0 border-r border-neutral-200 p-3 md:block dark:border-neutral-800">
        <BookSidebar books={books} selectedId={bookId} totalCount={libraryTotal} onSelect={selectBook} />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
          <div class="relative min-w-52 flex-1">
            <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" aria-hidden="true">⌕</span>
            <input
              type="search"
              bind:value={query}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              class="w-full rounded-full border border-neutral-200 bg-neutral-50 py-2 pr-8 pl-9 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
            />
            {#if query !== ""}
              <button
                type="button"
                onclick={() => (query = "")}
                aria-label={t("search.clear")}
                class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                ×
              </button>
            {/if}
          </div>
          <div class="flex items-center gap-1.5" role="group" aria-label={t("kind.group")}>
            {#each KIND_OPTIONS as option (option)}
              {@const active = kinds.includes(option)}
              <button
                type="button"
                onclick={() => toggleKind(option)}
                aria-pressed={active}
                class="rounded-full border px-3 py-2 text-sm font-medium transition {active
                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
              >
                {t(`kind.${option}`)}
              </button>
            {/each}
          </div>
          <button
            type="button"
            onclick={toggleFavoritesOnly}
            aria-pressed={favoritesOnly}
            title={t("fav.hint")}
            class="rounded-full border px-3 py-2 text-sm font-medium transition {favoritesOnly
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-300'
              : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
          >
            {t("fav.toggle")}
          </button>
        </div>

        <div class="flex-1 space-y-3 overflow-y-auto px-6 py-4 {loading ? 'opacity-50' : ''}">
          {#if result && result.items.length > 0}
            {#each result.items as clipping (clipping.id)}
              <ClippingCard
                {clipping}
                copied={clipping.id === copiedId}
                onToggleFavorite={toggleStar}
                onCopy={copyContent}
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
