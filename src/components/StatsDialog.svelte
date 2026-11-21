<script lang="ts">
  import { getContext } from "svelte";
  import { donutSegments } from "../lib/donut";
  import { I18N_CONTEXT_KEY, type I18nContext, countText } from "../lib/i18n";
  import { ScrollFade } from "../lib/scrollFade.svelte";
  import type { ReadingStats } from "../lib/stats";
  import type { ClippingKind } from "../lib/types";
  import Modal from "./Modal.svelte";
  import ScrollFadeOverlay from "./ScrollFadeOverlay.svelte";

  interface Props {
    stats: ReadingStats | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
    /** Stats drill-down: the list shows only this kind. */
    onFilterKind: (kind: ClippingKind) => void;
  }

  const { stats, loading, error, onClose, onFilterKind }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  const total = $derived(stats?.total ?? 0);
  /** A kind keeps its slice color no matter how the counts rank. */
  const KIND_COLOR: Record<ClippingKind, number> = {
    highlight: 1,
    bookmark: 2,
    note: 3,
  };
  let hoveredKind = $state<ClippingKind | null>(null);
  /** Slice whose legend row holds keyboard focus; hover wins while it lasts. */
  let focusedKind = $state<ClippingKind | null>(null);
  const activeKind = $derived(hoveredKind ?? focusedKind);
  const kindSegments = $derived(donutSegments(stats?.kinds.map((row) => row.count) ?? []));
  const yearMax = $derived(Math.max(1, ...(stats?.years.map((row) => row.count) ?? [])));
  const bookMax = $derived(Math.max(1, ...(stats?.books.map((row) => row.count) ?? [])));

  const fade = new ScrollFade();

  /** Bar width for one bucket; every chart scales to its own maximum. */
  function width(count: number, max: number): string {
    return `${Math.round((count / max) * 100)}%`;
  }

  function percent(count: number): number {
    return total === 0 ? 0 : Math.round((count / total) * 100);
  }
</script>

<Modal
    label={i18n.t("stats.title")}
    onClose={onClose}
    panel="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface-raised"
  >
    <header class="border-b border-line-subtle px-5 py-4">
      <h2 class="text-sm font-medium text-fg">
        {i18n.t("stats.title")}
      </h2>
      {#if stats && !loading && !error}
        <p class="mt-1 text-sm text-fg-muted">
          {i18n.t("stats.summary", {
            clippings: countText(i18n.locale, "clipping", stats.total),
            books: countText(i18n.locale, "book", stats.bookCount),
          })}
        </p>
      {/if}
    </header>

    <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        use:fade.track
        class="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        {#if loading}
          <p class="text-sm text-fg-muted" role="status">
            {i18n.t("stats.loading")}
          </p>
        {:else if error}
          <p class="text-sm text-danger" role="alert">{error}</p>
        {:else if stats && stats.total > 0}
          <section aria-labelledby="stats-year">
            <h3
              id="stats-year"
              class="text-xs font-medium tracking-wide text-fg-muted uppercase"
            >
              {i18n.t("stats.byYear")}
            </h3>
            <ul class="mt-2 space-y-1.5">
              {#each stats.years as row (row.year ?? "unknown")}
                <li class="flex items-center gap-3 text-sm">
                  <span class="w-16 shrink-0 font-medium tabular-nums">
                    {row.year ?? i18n.t("stats.unknownYear")}
                  </span>
                  <span
                    class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-accent"
                      style={`width: ${width(row.count, yearMax)}`}
                    ></span>
                  </span>
                  <span class="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                    {row.count}
                  </span>
                </li>
              {/each}
            </ul>
          </section>

          <section class="mt-5" aria-labelledby="stats-kind">
            <h3
              id="stats-kind"
              class="text-xs font-medium tracking-wide text-fg-muted uppercase"
            >
              {i18n.t("stats.byKind")}
            </h3>
            <div class="mt-2 flex items-center gap-5">
              <div class="relative h-36 w-36 shrink-0">
                <svg viewBox="0 0 120 120" class="h-full w-full" aria-hidden="true">
                  <g transform="rotate(-90 60 60)">
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke-width="17"
                      style="stroke: var(--surface-hover)"
                    />
                    {#each kindSegments as segment (segment.index)}
                      {@const row = stats.kinds[segment.index]}
                      <!-- Mouse-only duplicate of the legend buttons below: every
                           number and action stays reachable from the keyboard there. -->
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <circle
                        cx="60"
                        cy="60"
                        r="50"
                        fill="none"
                        pathLength="100"
                        stroke-width={activeKind === row.kind ? 19 : 17}
                        stroke-dasharray={`${segment.dash} ${100 - segment.dash}`}
                        stroke-dashoffset={segment.offset}
                        style={`stroke: var(--chart-${KIND_COLOR[row.kind]})`}
                        class="cursor-pointer transition-[stroke-width,opacity] duration-150 {activeKind !==
                        null && activeKind !== row.kind
                          ? 'opacity-40'
                          : ''}"
                        onmouseenter={() => (hoveredKind = row.kind)}
                        onmouseleave={() => (hoveredKind = null)}
                        onclick={() => onFilterKind(row.kind)}
                      >
                        <title>
                          {i18n.t(`kind.${row.kind}`)}: {row.count} · {percent(row.count)}%
                        </title>
                      </circle>
                    {/each}
                  </g>
                </svg>
                <div class="pointer-events-none absolute inset-0 grid place-content-center text-center">
                  <span class="text-lg font-semibold tabular-nums text-fg">{total}</span>
                  <span class="text-[0.66rem] text-fg-subtle">
                    {i18n.t("stats.chartTotal")}
                  </span>
                </div>
              </div>
              <ul class="min-w-0 flex-1 space-y-1">
                {#each stats.kinds as row (row.kind)}
                  <li>
                    <button
                      type="button"
                      onclick={() => onFilterKind(row.kind)}
                      onmouseenter={() => (hoveredKind = row.kind)}
                      onmouseleave={() => (hoveredKind = null)}
                      onfocus={() => (focusedKind = row.kind)}
                      onblur={() => (focusedKind = null)}
                      title={i18n.t("stats.filterKind", {
                        kind: i18n.t(`kind.${row.kind}`),
                      })}
                      class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm transition-colors hover:bg-surface-hover {activeKind ===
                      row.kind
                        ? 'bg-surface-hover'
                        : ''}"
                    >
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={`background: var(--chart-${KIND_COLOR[row.kind]})`}
                        aria-hidden="true"
                      ></span>
                      <span class="min-w-0 flex-1 truncate">
                        {i18n.t(`kind.${row.kind}`)}
                      </span>
                      <span class="shrink-0 tabular-nums text-fg-muted">
                        {row.count} · {percent(row.count)}%
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          </section>

          <section class="mt-5" aria-labelledby="stats-book">
            <h3
              id="stats-book"
              class="text-xs font-medium tracking-wide text-fg-muted uppercase"
            >
              {i18n.t("stats.byBook")}
            </h3>
            <ul class="mt-2 space-y-2">
              {#each stats.books as row (row.title + "\u0000" + (row.author ?? ""))}
                <li>
                  <div class="flex items-baseline gap-3 text-sm">
                    <span class="min-w-0 flex-1 truncate font-medium" title={row.title}>
                      {row.title}
                    </span>
                    <span class="shrink-0 tabular-nums text-fg-muted">
                      {row.count}
                    </span>
                  </div>
                  {#if row.author}
                    <p class="truncate text-xs text-fg-muted">
                      {row.author}
                    </p>
                  {/if}
                  <span
                    class="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-hover"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-fg-subtle/50"
                      style={`width: ${width(row.count, bookMax)}`}
                    ></span>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {:else}
          <p class="text-sm text-fg-muted">{i18n.t("stats.empty")}</p>
        {/if}
      </div>
      <ScrollFadeOverlay
        visible={fade.moreBelow}
        class="inset-x-0 -bottom-px h-8"
      />
    </div>

    <footer class="flex justify-end border-t border-line-subtle px-5 py-3">
      <button
        type="button"
        onclick={onClose}
        class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover"
      >
        {i18n.t("stats.dismiss")}
      </button>
    </footer>
</Modal>
