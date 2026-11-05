<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { focusOnMount, trapFocus } from "../lib/focus";
  import type { ReadingStats } from "../lib/stats";

  interface Props {
    stats: ReadingStats | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
  }

  const { stats, loading, error, onClose }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  const total = $derived(stats?.total ?? 0);
  const yearMax = $derived(Math.max(1, ...(stats?.years.map((row) => row.count) ?? [])));
  const bookMax = $derived(Math.max(1, ...(stats?.books.map((row) => row.count) ?? [])));

  /** Bar width for one bucket; every chart scales to its own maximum. */
  function width(count: number, max: number): string {
    return `${Math.round((count / max) * 100)}%`;
  }

  function percent(count: number): number {
    return total === 0 ? 0 : Math.round((count / total) * 100);
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={i18n.t("stats.close")}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("stats.title")}
    tabindex="-1"
    use:focusOnMount
    use:trapFocus
    class="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
  >
    <header class="border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
      <h2 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {i18n.t("stats.title")}
      </h2>
      {#if stats && !loading && !error}
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {i18n.t("stats.summary", { clippings: stats.total, books: stats.bookCount })}
        </p>
      {/if}
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {#if loading}
        <p class="text-sm text-neutral-500 dark:text-neutral-400" role="status">
          {i18n.t("stats.loading")}
        </p>
      {:else if error}
        <p class="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>
      {:else if stats && stats.total > 0}
        <section aria-labelledby="stats-year">
          <h3
            id="stats-year"
            class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
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
                  class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                  aria-hidden="true"
                >
                  <span
                    class="block h-full rounded-full bg-amber-400 dark:bg-amber-500"
                    style={`width: ${width(row.count, yearMax)}`}
                  ></span>
                </span>
                <span class="w-10 shrink-0 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {row.count}
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="mt-5" aria-labelledby="stats-kind">
          <h3
            id="stats-kind"
            class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
          >
            {i18n.t("stats.byKind")}
          </h3>
          <ul class="mt-2 space-y-1.5">
            {#each stats.kinds as row (row.kind)}
              <li class="flex items-center gap-3 text-sm">
                <span class="w-24 shrink-0 truncate">{i18n.t(`kind.${row.kind}`)}</span>
                <span
                  class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                  aria-hidden="true"
                >
                  <span
                    class="block h-full rounded-full bg-neutral-400 dark:bg-neutral-500"
                    style={`width: ${percent(row.count)}%`}
                  ></span>
                </span>
                <span class="w-16 shrink-0 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {row.count} · {percent(row.count)}%
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="mt-5" aria-labelledby="stats-book">
          <h3
            id="stats-book"
            class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
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
                  <span class="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                    {row.count}
                  </span>
                </div>
                {#if row.author}
                  <p class="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {row.author}
                  </p>
                {/if}
                <span
                  class="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                  aria-hidden="true"
                >
                  <span
                    class="block h-full rounded-full bg-neutral-300 dark:bg-neutral-600"
                    style={`width: ${width(row.count, bookMax)}`}
                  ></span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">{i18n.t("stats.empty")}</p>
      {/if}
    </div>

    <footer class="flex justify-end border-t border-neutral-100 px-5 py-3 dark:border-neutral-800">
      <button
        type="button"
        onclick={onClose}
        class="rounded-full border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {i18n.t("stats.dismiss")}
      </button>
    </footer>
  </div>
</div>
