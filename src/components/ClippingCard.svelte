<script lang="ts">
  import { formatAddedOn, formatReference, KIND_LABELS } from "../lib/library";
  import type { ClippingRow } from "../lib/types";

  interface Props {
    clipping: ClippingRow;
    onToggleFavorite: (id: number) => void;
  }

  const { clipping, onToggleFavorite }: Props = $props();
  const reference = $derived(formatReference(clipping.page, clipping.location));
</script>

<article
  class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
>
  {#if clipping.content}
    <blockquote
      class="border-l-2 border-amber-400 pl-4 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200"
    >
      {clipping.content}
    </blockquote>
  {:else}
    <p class="text-sm text-neutral-400 italic dark:text-neutral-500">
      {KIND_LABELS[clipping.kind]} sin texto
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span class="font-medium text-neutral-900 dark:text-neutral-100">{clipping.title}</span>
    {#if clipping.author}
      <span class="text-neutral-500 dark:text-neutral-400">{clipping.author}</span>
    {/if}
  </div>

  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
    <span
      class="rounded-full bg-neutral-100 px-2.5 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
    >
      {KIND_LABELS[clipping.kind]}
    </span>
    {#if reference !== ""}
      <span>{reference}</span>
    {/if}
    <span>{formatAddedOn(clipping.added_on, clipping.added_on_raw)}</span>
    <span class="flex-1"></span>
    <button
      type="button"
      onclick={() => onToggleFavorite(clipping.id)}
      aria-label={clipping.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
      aria-pressed={clipping.favorite}
      title={clipping.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
      class="rounded-full p-1.5 text-lg leading-none transition {clipping.favorite
        ? 'text-amber-500 hover:text-amber-600'
        : 'text-neutral-300 hover:text-amber-400 dark:text-neutral-600 dark:hover:text-amber-400'}"
    >
      {clipping.favorite ? "★" : "☆"}
    </button>
  </div>
</article>
