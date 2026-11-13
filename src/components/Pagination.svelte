<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { PAGE_SIZES, pageWindow } from "../lib/pagination";

  interface Props {
    page: number;
    total: number;
    pageSize: number;
    onSelect: (page: number) => void;
    onSizeChange: (pageSize: number) => void;
  }

  const { page, total, pageSize, onSelect, onSizeChange }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
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
  <p class="text-sm text-fg-muted" aria-live="polite">
    {i18n.t("pg.range", { from, to, total })}
  </p>

  <div class="flex items-center gap-1">
    <button
      type="button"
      onclick={prev}
      disabled={page <= 1}
      aria-label={i18n.t("pg.prev")}
      class="rounded-lg px-2.5 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-30"
    >
      ‹
    </button>

    {#each window as item, index (index)}
      {#if item === "…"}
        <span class="px-1 text-sm text-fg-subtle">…</span>
      {:else}
        <button
          type="button"
          onclick={() => onSelect(item)}
          aria-label={i18n.t("pg.page", { n: item })}
          aria-current={item === page ? "page" : undefined}
          class="min-w-8 rounded-lg px-2 py-1.5 text-sm transition {item === page
            ? 'bg-inverse font-medium text-inverse-fg'
            : 'text-fg-muted hover:bg-surface-hover'}"
        >
          {item}
        </button>
      {/if}
    {/each}

    <button
      type="button"
      onclick={next}
      disabled={page >= pages}
      aria-label={i18n.t("pg.next")}
      class="rounded-lg px-2.5 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-30"
    >
      ›
    </button>
  </div>

  <label class="flex items-center gap-2 text-sm text-fg-muted">
    {i18n.t("pg.perPage")}
    <select
      value={pageSize}
      onchange={(event) => onSizeChange(Number(event.currentTarget.value))}
      class="rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-fg"
    >
      {#each PAGE_SIZES as size (size)}
        <option value={size}>{size}</option>
      {/each}
    </select>
  </label>
</div>
