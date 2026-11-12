<script lang="ts">
  import { getContext } from "svelte";
  import Icon from "./Icon.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { AuthorGroup } from "../lib/library";
  import type { SidebarView } from "../lib/sidebar";
  import type { Book } from "../lib/types";
  import { hasMoreBelow } from "../lib/scroll";

  interface Props {
    books: Book[];
    /** Author groups derived from the same sorted books (S5, S7). */
    groups: AuthorGroup[];
    view: SidebarView;
    onViewChange: (view: SidebarView) => void;
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
    groups,
    view,
    onViewChange,
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
  /** Author groups collapsed in this session (S7). */
  let collapsed = $state<Set<string>>(new Set());

  function measureFade(): void {
    const element = listEl;
    moreBelow = element !== null && hasMoreBelow(element);
  }

  function toggleGroup(key: string): void {
    const next = new Set(collapsed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    collapsed = next;
  }

  function expandAllGroups(): void {
    collapsed = new Set();
  }

  function collapseAllGroups(): void {
    collapsed = new Set(groups.map((group) => group.key));
  }

  // Re-measure whenever the scroller is resized or the sidebar is toggled in.
  $effect(() => {
    const element = listEl;
    if (element === null) return;
    const observer = new ResizeObserver(measureFade);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // Re-measure after the book list, the view or a group changes, once the new
  // rows are in the DOM.
  $effect(() => {
    void books;
    void groups;
    void view;
    void collapsed;
    void listEl;
    measureFade();
  });
</script>

{#snippet bookRow(book: Book, showAuthor: boolean)}
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
      {#if showAuthor && book.author}
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
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <nav class="relative flex min-h-0 flex-1 flex-col" aria-label={i18n.t("sidebar.nav")}>
    <div class="mb-2 flex items-center gap-1.5" role="group" aria-label={i18n.t("sidebar.view")}>
      <button
        type="button"
        onclick={() => onViewChange("books")}
        aria-pressed={view === "books"}
        class="rounded-full border px-2.5 py-1 text-xs font-medium transition {view === 'books'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("sidebar.viewBooks")}
      </button>
      <button
        type="button"
        onclick={() => onViewChange("authors")}
        aria-pressed={view === "authors"}
        class="rounded-full border px-2.5 py-1 text-xs font-medium transition {view === 'authors'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("sidebar.viewAuthors")}
      </button>
    </div>
    <div class="mb-2 flex items-center gap-1.5">
      <div class="flex items-center gap-1.5" role="group" aria-label={i18n.t("sort.toggle")}>
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
      {#if view === "authors" && groups.length > 0}
        <div class="flex items-center gap-1">
          <button
            type="button"
            onclick={expandAllGroups}
            aria-label={i18n.t("sidebar.expandAll")}
            title={i18n.t("sidebar.expandAll")}
            class="flex h-7 w-7 items-center justify-center rounded-full border border-line text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
            <Icon name="chevronsDown" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onclick={collapseAllGroups}
            aria-label={i18n.t("sidebar.collapseAll")}
            title={i18n.t("sidebar.collapseAll")}
            class="flex h-7 w-7 items-center justify-center rounded-full border border-line text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
            <Icon name="chevronsUp" class="h-3.5 w-3.5" />
          </button>
        </div>
      {/if}
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
      {#if view === "books"}
        {#each books as book (book.id)}
          {@render bookRow(book, true)}
        {/each}
      {:else}
        {#each groups as group, index (group.key)}
          <div>
            <button
              type="button"
              onclick={() => toggleGroup(group.key)}
              aria-expanded={!collapsed.has(group.key)}
              aria-controls={`author-group-${index}`}
              class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-surface-hover"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium text-fg">
                  {group.name ?? i18n.t("filters.unknownAuthor")}
                </span>
                <span class="block truncate text-xs text-fg-subtle">
                  {i18n.t("sidebar.groupCounts", {
                    books: group.bookCount,
                    clippings: group.clippingCount,
                  })}
                </span>
              </span>
              <Icon
                name="chevron"
                class="h-4 w-4 shrink-0 text-fg-subtle transition-transform {collapsed.has(group.key)
                  ? ''
                  : 'rotate-90'}"
              />
            </button>
            <div
              id={`author-group-${index}`}
              hidden={collapsed.has(group.key)}
              class="space-y-0.5"
            >
              {#each group.books as book (book.id)}
                {@render bookRow(book, false)}
              {/each}
            </div>
          </div>
        {/each}
      {/if}
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
