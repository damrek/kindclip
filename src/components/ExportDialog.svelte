<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import Modal from "./Modal.svelte";
  import type { ExportFormat } from "../lib/exporter";

  interface Props {
    count: number;
    scope: string;
    busy: boolean;
    onClose: () => void;
    onExport: (format: ExportFormat, includeOriginal: boolean, perBook: boolean) => void;
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
  let perBook = $state(false);

  const summary = $derived(i18n.t("export.summary", { count, scope }));
</script>

<Modal
    label={i18n.t("export.title")}
    onClose={onClose} busy={busy}
    panel="w-full max-w-md rounded-2xl border border-line bg-surface-raised p-5"
  >
    <h2 class="text-sm font-medium text-fg">
      {i18n.t("export.title")}
    </h2>
    <p class="mt-1 text-sm text-fg-muted">{summary}</p>

    <fieldset class="mt-3">
      <legend class="text-xs font-medium text-fg-muted">
        {i18n.t("export.format")}
      </legend>
      <div class="mt-1.5 flex items-center gap-4">
        {#each FORMAT_OPTIONS as option (option.value)}
          <label class="flex items-center gap-2 text-sm text-fg">
            <input
              type="radio"
              name="export-format"
              value={option.value}
              checked={format === option.value}
              onchange={() => (format = option.value)}
              disabled={busy}
              class="accent-[var(--accent)]"
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if format === "markdown"}
      <label class="mt-3 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          bind:checked={includeOriginal}
          disabled={busy}
          class="accent-[var(--accent)]"
        />
        {i18n.t("export.includeOriginal")}
      </label>
      <label class="mt-2 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          bind:checked={perBook}
          disabled={busy}
          class="accent-[var(--accent)]"
        />
        {i18n.t("export.perBook")}
      </label>
    {/if}

    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onclick={onClose}
        disabled={busy}
        class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
      >
        {i18n.t("card.cancel")}
      </button>
      <button
        type="button"
        onclick={() => onExport(format, includeOriginal, format === "markdown" && perBook)}
        disabled={busy}
        class="rounded-full bg-inverse px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:opacity-80 disabled:opacity-50"
      >
        {i18n.t("export.button")}
      </button>
    </div>
</Modal>
