<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { formatAddedOn, formatReference } from "../lib/library";
  import type { ClippingRow } from "../lib/types";
  import HighlightedText from "./HighlightedText.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    clipping: ClippingRow;
    /** Search query that produced the visible list, for highlight marks. */
    query: string;
    /** 1-based position across the whole filtered list. */
    position: number;
    total: number;
    canPrev: boolean;
    canNext: boolean;
    loading: boolean;
    error: string | null;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
  }

  const {
    clipping,
    query,
    position,
    total,
    canPrev,
    canNext,
    loading,
    error,
    onPrev,
    onNext,
    onClose,
  }: Props = $props();

  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  let panel = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);

  const displayContent = $derived(clipping.content_edited ?? clipping.content);
  const kindLabel = $derived(i18n.t(`kind.${clipping.kind}`));
  const reference = $derived(formatReference(clipping.page, clipping.location));
  const addedOnLabel = $derived(
    formatAddedOn(clipping.added_on, clipping.added_on_raw, i18n.locale),
  );

  onMount(() => panel?.focus());

  // Every clipping starts at the top of the text column.
  $effect(() => {
    void clipping.id;
    scroller?.scrollTo({ top: 0 });
  });

  /** ←/→ walk the filtered list, Esc closes; modifiers stay native. */
  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (canPrev && !loading) {
        onPrev();
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (canNext && !loading) {
        onNext();
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  bind:this={panel}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-label={i18n.t("reading.title")}
  class="reading-panel fixed inset-0 z-40 flex flex-col bg-surface"
>
  <header
    class="flex items-center gap-3 border-b border-line px-4 py-2.5"
  >
    <button
      type="button"
      onclick={onClose}
      aria-label={i18n.t("reading.close")}
      title={i18n.t("reading.close")}
      class="rounded-lg p-1.5 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
    >
      <Icon name="close" />
    </button>
    <p
      class="min-w-0 flex-1 truncate text-center text-xs font-medium text-fg-muted tabular-nums"
      aria-live="polite"
    >
      {i18n.t("reading.position", { current: position, total })}
    </p>
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={onPrev}
        disabled={!canPrev || loading}
        aria-label={i18n.t("reading.prev")}
        title={i18n.t("reading.prev")}
        class="rounded-lg px-3 py-1.5 text-lg leading-none text-fg-muted transition hover:bg-surface-hover disabled:opacity-30"
      >
        ‹
      </button>
      <button
        type="button"
        onclick={onNext}
        disabled={!canNext || loading}
        aria-label={i18n.t("reading.next")}
        title={i18n.t("reading.next")}
        class="rounded-lg px-3 py-1.5 text-lg leading-none text-fg-muted transition hover:bg-surface-hover disabled:opacity-30"
      >
        ›
      </button>
    </div>
  </header>

  <div
    bind:this={scroller}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    aria-busy={loading}
  >
    <article class="mx-auto max-w-2xl px-8 py-12">
      {#if displayContent}
        <blockquote
          class="border-l-2 border-accent pl-6 text-2xl leading-relaxed text-fg"
        >
          <HighlightedText text={displayContent} {query} />
        </blockquote>
      {:else}
        <p class="text-base text-fg-subtle italic">
          {i18n.t("card.noText", { kind: kindLabel })}
        </p>
      {/if}

      <div class="mt-10 border-t border-line pt-5">
        <p class="text-base font-semibold text-fg">
          <HighlightedText text={clipping.title} {query} />
        </p>
        {#if clipping.author}
          <p class="mt-0.5 text-sm text-fg-muted">
            <HighlightedText text={clipping.author} {query} />
          </p>
        {/if}
        <div
          class="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted"
        >
          <span
            class="rounded-full bg-surface-hover px-2.5 py-0.5 font-medium text-fg-muted"
          >
            {kindLabel}
          </span>
          {#if reference !== ""}
            <span>{reference}</span>
          {/if}
          <span>{addedOnLabel}</span>
          {#each clipping.tags as tag (tag.id)}
            <span
              class="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-text"
            >
              #{tag.name}
            </span>
          {/each}
        </div>
      </div>
    </article>
  </div>

  <div
    class="flex items-center justify-center gap-3 border-t border-line px-6 py-3"
  >
    {#if error}
      <p class="truncate text-xs text-danger" role="alert">
        {error}
      </p>
    {:else}
      <p class="text-xs text-fg-subtle">
        {i18n.t("reading.hint")}
      </p>
    {/if}
  </div>
</div>

<style>
  /* The dialog itself takes focus; the global :focus-visible ring is for controls. */
  .reading-panel:focus {
    outline: none;
  }
</style>
