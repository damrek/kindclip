<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { ExportFormat } from "../lib/exporter";

  interface Props {
    count: number;
    scope: string;
    busy: boolean;
    onClose: () => void;
    onExport: (format: ExportFormat, includeOriginal: boolean) => void;
  }

  const { count, scope, busy, onClose, onExport }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  /** Format names stay stable across locales (JSON/CSV schema language). */
  const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
    { value: "markdown", label: "Markdown" },
    { value: "json", label: "JSON" },
    { value: "csv", label: "CSV" },
  ];

  let format = $state<ExportFormat>("markdown");
  let includeOriginal = $state(false);

  const summary = $derived(i18n.t("export.summary", { count, scope }));
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={i18n.t("card.cancel")}
    disabled={busy}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("export.title")}
    tabindex="-1"
    class="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900"
  >
    <h2 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
      {i18n.t("export.title")}
    </h2>
    <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>

    <fieldset class="mt-3">
      <legend class="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {i18n.t("export.format")}
      </legend>
      <div class="mt-1.5 flex items-center gap-4">
        {#each FORMAT_OPTIONS as option (option.value)}
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="radio"
              name="export-format"
              value={option.value}
              checked={format === option.value}
              onchange={() => (format = option.value)}
              disabled={busy}
              class="accent-neutral-900 dark:accent-neutral-100"
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if format === "markdown"}
      <label class="mt-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          bind:checked={includeOriginal}
          disabled={busy}
          class="accent-neutral-900 dark:accent-neutral-100"
        />
        {i18n.t("export.includeOriginal")}
      </label>
    {/if}

    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onclick={onClose}
        disabled={busy}
        class="rounded-full border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {i18n.t("card.cancel")}
      </button>
      <button
        type="button"
        onclick={() => onExport(format, includeOriginal)}
        disabled={busy}
        class="rounded-full bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:opacity-80 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {i18n.t("export.button")}
      </button>
    </div>
  </div>
</div>
