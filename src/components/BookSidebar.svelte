<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { Book } from "../lib/types";

  interface Props {
    books: Book[];
    selectedId: number | null;
    totalCount: number;
    onSelect: (bookId: number | null) => void;
  }

  const { books, selectedId, totalCount, onSelect }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
</script>

<nav class="flex h-full flex-col" aria-label={i18n.t("sidebar.nav")}>
  <button
    type="button"
    onclick={() => onSelect(null)}
    class="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition {selectedId ===
    null
      ? 'bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900'
      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'}"
  >
    <span>{i18n.t("sidebar.all")}</span>
    <span
      class="rounded-full px-2 py-0.5 text-xs {selectedId === null
        ? 'bg-white/20 dark:bg-neutral-900/10'
        : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400'}"
    >
      {totalCount}
    </span>
  </button>

  <div class="mt-1 flex-1 space-y-0.5 overflow-y-auto">
    {#each books as book (book.id)}
      <button
        type="button"
        onclick={() => onSelect(book.id)}
        class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition {selectedId ===
        book.id
          ? 'bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'}"
      >
        <span class="min-w-0">
          <span class="block truncate" title={book.title}>{book.title}</span>
          {#if book.author}
            <span
              class="block truncate text-xs {selectedId === book.id
                ? 'opacity-70'
                : 'text-neutral-400 dark:text-neutral-500'}"
              title={book.author}
            >
              {book.author}
            </span>
          {/if}
        </span>
        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-xs {selectedId === book.id
            ? 'bg-white/20 dark:bg-neutral-900/10'
            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400'}"
        >
          {book.clipping_count}
        </span>
      </button>
    {/each}
  </div>
</nav>
