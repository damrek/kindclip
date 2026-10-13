<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { formatAddedOn, formatReference } from "../lib/library";
  import type { ClippingRow } from "../lib/types";

  interface Props {
    clipping: ClippingRow;
    copied: boolean;
    onToggleFavorite: (id: number) => void;
    onCopy: (id: number) => void;
  }

  const { clipping, copied, onToggleFavorite, onCopy }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const reference = $derived(formatReference(clipping.page, clipping.location));
  const kindLabel = $derived(i18n.t(`kind.${clipping.kind}`));
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
      {i18n.t("card.noText", { kind: kindLabel })}
    </p>
  {/if}

  <div class="mt-4 text-sm">
    <span class="block font-medium text-neutral-900 dark:text-neutral-100">{clipping.title}</span>
    {#if clipping.author}
      <span class="block text-neutral-500 dark:text-neutral-400">{clipping.author}</span>
    {/if}
  </div>

  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
    <span
      class="rounded-full bg-neutral-100 px-2.5 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
    >
      {kindLabel}
    </span>
    {#if reference !== ""}
      <span>{reference}</span>
    {/if}
    <span>{formatAddedOn(clipping.added_on, clipping.added_on_raw, i18n.locale)}</span>
    <span class="flex-1"></span>
    {#if clipping.content}
      <button
        type="button"
        onclick={() => onCopy(clipping.id)}
        aria-label={i18n.t("card.copy")}
        title={copied ? i18n.t("card.copied") : i18n.t("card.copy")}
        class="rounded-full p-1.5 text-base leading-none transition {copied
          ? 'text-green-600 dark:text-green-400'
          : 'text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-300'}"
      >
        {copied ? "✓" : "⧉"}
      </button>
    {/if}
    <button
      type="button"
      onclick={() => onToggleFavorite(clipping.id)}
      aria-label={clipping.favorite ? i18n.t("card.unfav") : i18n.t("card.fav")}
      aria-pressed={clipping.favorite}
      title={clipping.favorite ? i18n.t("card.unfav") : i18n.t("card.fav")}
      class="rounded-full p-1.5 text-lg leading-none transition {clipping.favorite
        ? 'text-amber-500 hover:text-amber-600'
        : 'text-neutral-300 hover:text-amber-400 dark:text-neutral-600 dark:hover:text-amber-400'}"
    >
      {clipping.favorite ? "★" : "☆"}
    </button>
  </div>
</article>
