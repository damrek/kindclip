<script lang="ts">
  import BookSidebar from "./components/BookSidebar.svelte";
  import ClippingCard from "./components/ClippingCard.svelte";
  import Pagination from "./components/Pagination.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import { getDb, listBooks, listClippings, toggleFavorite } from "./lib/db";
  import { runImportFlow, tauriImportDeps } from "./lib/importer";
  import {
    applyFavoriteToggle,
    clampPage,
    copyClippingContent,
    debounce,
    KIND_LABELS,
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
  let kind = $state<ClippingKind | null>(null);
  let favoritesOnly = $state(false);
  let page = $state(1);
  let pageSize = $state(20);

  let importing = $state(false);
  let importStatus = $state<string | null>(null);
  let copiedId = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const filter = $derived<ClippingFilter>({ query: debouncedQuery, bookId, kind, favoritesOnly });

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
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

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

  function selectBook(id: number | null): void {
    bookId = id;
    page = 1;
  }

  function selectKind(value: string): void {
    kind = value === "" ? null : (value as ClippingKind);
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
    selectBook(null);
    selectKind("");
  }

  async function onImport(): Promise<void> {
    if (importing) return;
    importing = true;
    importStatus = "Leyendo fichero…";
    try {
      const outcome = await runImportFlow(tauriImportDeps(), (done, total) => {
        importStatus = `Importando ${done}/${total}…`;
      });
      if (outcome.status === "cancelled") {
        importStatus = null;
      } else if (outcome.status === "empty") {
        importStatus = `Sin clippings en ${outcome.path}.`;
      } else {
        const report = outcome.report;
        importStatus = report.alreadyImported
          ? "Ese fichero ya estaba importado."
          : `Importados ${report.inserted} de ${report.total} (${report.duplicates} duplicados, ${report.bookCount} libros).`;
        page = 1;
        await loadBooks();
        await loadList(filter, 1, pageSize);
      }
    } catch (error) {
      importStatus = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importing = false;
    }
  }

  const hasLibrary = $derived(books.length > 0);
  const hasActiveFilters = $derived(
    debouncedQuery.trim() !== "" || bookId !== null || kind !== null || favoritesOnly,
  );
</script>

<div class="flex h-full flex-col">
  <header
    class="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
  >
    <h1 class="text-base font-semibold tracking-tight">kindclip</h1>
    <div class="flex items-center gap-1">
      <ThemeToggle />
      {#if importStatus}
        <p class="text-sm text-neutral-500 dark:text-neutral-400" role="status">{importStatus}</p>
      {/if}
      <button
        type="button"
        onclick={onImport}
        disabled={importing}
        class="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {importing ? "Importando…" : "Importar"}
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
        <h2 class="text-base font-medium">Todavía no hay clippings</h2>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Importa tu fichero <span class="font-mono">My Clippings.txt</span> para empezar.
        </p>
        <button
          type="button"
          onclick={onImport}
          disabled={importing}
          class="mt-4 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {importing ? "Importando…" : "Importar clippings"}
        </button>
      </div>
    </main>
  {:else}
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-64 shrink-0 border-r border-neutral-200 p-3 md:block dark:border-neutral-800">
        <BookSidebar books={books} selectedId={bookId} totalCount={result?.total ?? 0} onSelect={selectBook} />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
          <div class="relative min-w-52 flex-1">
            <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" aria-hidden="true">⌕</span>
            <input
              type="search"
              bind:value={query}
              placeholder="Buscar en texto, libros y autores…"
              aria-label="Buscar clippings"
              class="w-full rounded-full border border-neutral-200 bg-neutral-50 py-2 pr-8 pl-9 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
            />
            {#if query !== ""}
              <button
                type="button"
                onclick={() => (query = "")}
                aria-label="Limpiar búsqueda"
                class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                ×
              </button>
            {/if}
          </div>
          <select
            value={kind ?? ""}
            onchange={(event) => selectKind(event.currentTarget.value)}
            aria-label="Filtrar por tipo"
            class="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <option value="">Todos los tipos</option>
            <option value="highlight">{KIND_LABELS.highlight}</option>
            <option value="note">{KIND_LABELS.note}</option>
            <option value="bookmark">{KIND_LABELS.bookmark}</option>
          </select>
          <button
            type="button"
            onclick={toggleFavoritesOnly}
            aria-pressed={favoritesOnly}
            title="Mostrar solo favoritos"
            class="rounded-full border px-3 py-2 text-sm font-medium transition {favoritesOnly
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-300'
              : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
          >
            ★ Favoritos
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
              <p class="text-base font-medium">Sin resultados</p>
              <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {#if hasActiveFilters}
                  Ningún clipping coincide con estos filtros.
                {:else}
                  Esta selección no tiene clippings.
                {/if}
              </p>
              {#if hasActiveFilters}
                <button
                  type="button"
                  onclick={clearFilters}
                  class="mt-4 rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Limpiar filtros
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
