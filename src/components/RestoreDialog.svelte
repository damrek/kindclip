<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { focusOnMount, trapFocus } from "../lib/focus";
  import type { BackupInfo } from "../lib/backup";

  interface Props {
    fileName: string;
    info: BackupInfo | null;
    checking: boolean;
    busy: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: () => void;
  }

  const { fileName, info, checking, busy, error, onClose, onConfirm }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={i18n.t("restore.close")}
    disabled={busy}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("restore.title")}
    tabindex="-1"
    use:focusOnMount
    use:trapFocus
    class="relative w-full max-w-md rounded-2xl border border-line bg-surface-raised p-5"
  >
    <h2 class="text-sm font-medium text-fg">
      {i18n.t("restore.title")}
    </h2>

    {#if error}
      <p class="mt-2 text-sm text-danger" role="alert">{error}</p>
      <div class="mt-4 flex items-center justify-end">
        <button
          type="button"
          onclick={onClose}
          class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
        >
          {i18n.t("restore.close")}
        </button>
      </div>
    {:else if checking || info === null}
      <p class="mt-2 text-sm text-fg-muted" role="status">
        {i18n.t("restore.checking")}
      </p>
    {:else}
      <p class="mt-1 text-sm text-fg-muted">
        {i18n.t("restore.summary", {
          file: fileName,
          clippings: info.clippings,
          books: info.books,
          tags: info.tags,
        })}
      </p>
      <p class="mt-3 text-sm text-accent-text">{i18n.t("restore.warning")}</p>

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
          onclick={onConfirm}
          disabled={busy}
          class="rounded-full bg-danger-solid px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover disabled:opacity-50"
        >
          {i18n.t("restore.confirm")}
        </button>
      </div>
    {/if}
  </div>
</div>
