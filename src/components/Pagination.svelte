<script lang="ts">
  import { PAGE_SIZES, pageWindow } from "../lib/library";

  interface Props {
    page: number;
    total: number;
    pageSize: number;
    onSelect: (page: number) => void;
    onSizeChange: (pageSize: number) => void;
  }

  const { page, total, pageSize, onSelect, onSizeChange }: Props = $props();
  const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  const window = $derived(pageWindow(page, pages));
  const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
  const to = $derived(Math.min(total, page * pageSize));

  function prev(): void {
    if (page > 1) onSelect(page - 1);
  }

  function next(): void {
    if (page < pages) onSelect(page + 1);
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
  <p class="text-sm text-neutral-500 dark:text-neutral-400" aria-live="polite">
    {from}–{to} de {total}
  </p>

  <div class="flex items-center gap-1">
    <button
      type="button"
      onclick={prev}
      disabled={page <= 1}
      aria-label="Página anterior"
      class="rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      ‹
    </button>

    {#each window as item, index (index)}
      {#if item === "…"}
        <span class="px-1 text-sm text-neutral-400">…</span>
      {:else}
        <button
          type="button"
          onclick={() => onSelect(item)}
          aria-label={`Página ${item}`}
          aria-current={item === page ? "page" : undefined}
          class="min-w-8 rounded-lg px-2 py-1.5 text-sm transition {item === page
            ? 'bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900'
            : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
        >
          {item}
        </button>
      {/if}
    {/each}

    <button
      type="button"
      onclick={next}
      disabled={page >= pages}
      aria-label="Página siguiente"
      class="rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      ›
    </button>
  </div>

  <label class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
    Por página
    <select
      value={pageSize}
      onchange={(event) => onSizeChange(Number(event.currentTarget.value))}
      class="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
    >
      {#each PAGE_SIZES as size (size)}
        <option value={size}>{size}</option>
      {/each}
    </select>
  </label>
</div>
