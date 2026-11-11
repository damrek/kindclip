<script lang="ts">
  import { getContext } from "svelte";
  import Icon from "./Icon.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { Book } from "../lib/types";
  import { hasMoreBelow } from "../lib/scroll";

  interface Props {
    books: Book[];
    selectedId: number | null;
    totalCount: number;
    onSelect: (bookId: number | null) => void;
    sortBy?: "title" | "author";
    sortDir?: "asc" | "desc";
    onSortBy?: (key: "title" | "author") => void;
    onSortDirToggle?: () => void;
    onImport?: () => void;
    importing?: boolean;
    onOpenLibrary?: () => void;
    onOpenStats?: () => void;
    /** Library-scoped actions need an imported library to act on. */
    libraryActionsDisabled?: boolean;
  }

  const {
    books,
    selectedId,
    totalCount,
    onSelect,
    sortBy = "title",
    sortDir = "asc",
    onSortBy,
    onSortDirToggle,
    onImport,
    importing = false,
    onOpenLibrary,
    onOpenStats,
    libraryActionsDisabled = false,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  /** Book list scroller, measured for the bottom fade. */
  let listEl = $state<HTMLDivElement | null>(null);
  /** More books below the fold, so the fade is only drawn then. */
  let moreBelow = $state(false);

  function measureFade(): void {
    const element = listEl;
    moreBelow = element !== null && hasMoreBelow(element);
  }

  // Re-measure whenever the scroller is resized or the sidebar is toggled in.
  $effect(() => {
    const element = listEl;
    if (element === null) return;
    const observer = new ResizeObserver(measureFade);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // Re-measure after the book list changes, once the new rows are in the DOM.
  $effect(() => {
    void books;
    void listEl;
    measureFade();
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <nav class="relative flex min-h-0 flex-1 flex-col" aria-label={i18n.t("sidebar.nav")}>
    <div class="mb-2 flex items-center gap-1.5" role="group" aria-label={i18n.t("sort.toggle")}>
      <button
        type="button"
        onclick={() => onSortBy?.("title")}
        aria-pressed={sortBy === "title"}
        class="rounded-full border px-2.5 py-1 text-xs font-medium transition {sortBy === 'title'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("sort.title")}
      </button>
      <button
        type="button"
        onclick={() => onSortBy?.("author")}
        aria-pressed={sortBy === "author"}
        class="rounded-full border px-2.5 py-1 text-xs font-medium transition {sortBy === 'author'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("sort.author")}
      </button>
      <button
        type="button"
        onclick={() => onSortDirToggle?.()}
        aria-label={i18n.t("sort.toggle")}
        class="rounded-full border px-2.5 py-1 text-xs font-medium transition border-line text-fg-muted hover:bg-surface-hover"
      >
        {sortDir === "asc" ? "A–Z" : "Z–A"}
      </button>
    </div>
    <button
      type="button"
      onclick={() => onSelect(null)}
      class="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition {selectedId ===
      null
        ? 'bg-inverse font-medium text-inverse-fg'
        : 'text-fg hover:bg-surface-hover'}"
    >
      <span>{i18n.t("sidebar.all")}</span>
      <span
        class="rounded-full px-2 py-0.5 text-xs {selectedId === null
          ? 'bg-inverse-fg/20'
          : 'bg-surface-hover text-fg-muted'}"
      >
        {totalCount}
      </span>
    </button>

    <div
      class="mt-1 flex-1 space-y-0.5 overflow-y-auto"
      bind:this={listEl}
      onscroll={measureFade}
    >
      {#each books as book (book.id)}
        <button
          type="button"
          onclick={() => onSelect(book.id)}
          class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition {selectedId ===
          book.id
            ? 'bg-inverse font-medium text-inverse-fg'
            : 'text-fg hover:bg-surface-hover'}"
        >
          <span class="min-w-0">
            <span class="block truncate" title={book.title}>{book.title}</span>
            {#if book.author}
              <span
                class="block truncate text-xs {selectedId === book.id
                  ? 'opacity-70'
                  : 'text-fg-subtle'}"
                title={book.author}
              >
                {book.author}
              </span>
            {/if}
          </span>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-xs {selectedId === book.id
              ? 'bg-inverse-fg/20'
              : 'bg-surface-hover text-fg-muted'}"
          >
            {book.clipping_count}
          </span>
        </button>
      {/each}
    </div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-surface via-surface/80 to-transparent transition-opacity duration-150 {moreBelow
        ? 'opacity-100'
        : 'opacity-0'}"
    ></div>
  </nav>

  <div class="mt-2 shrink-0 space-y-0.5 border-t border-line-subtle pt-2">
    <button
      type="button"
      onclick={() => onImport?.()}
      disabled={importing}
      class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-fg transition hover:bg-surface-hover disabled:opacity-40"
    >
      <Icon name="plus" />
      <span class="min-w-0 flex-1 truncate">
        {importing ? i18n.t("header.importing") : i18n.t("header.import")}
      </span>
    </button>
    <button
      type="button"
      onclick={() => onOpenLibrary?.()}
      disabled={libraryActionsDisabled}
      class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
    >
      <Icon name="bookOpen" />
      <span class="min-w-0 flex-1 truncate">{i18n.t("library.open")}</span>
    </button>
    <button
      type="button"
      onclick={() => onOpenStats?.()}
      disabled={libraryActionsDisabled}
      class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
    >
      <Icon name="stats" />
      <span class="min-w-0 flex-1 truncate">{i18n.t("stats.open")}</span>
    </button>
  </div>
</div>
