<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext, countText } from "../lib/i18n";
  import Modal from "./Modal.svelte";
  import {
    autoBackupDate,
    formatBackupSize,
    type AutoBackup,
    type BackupInfo,
  } from "../lib/backup";

  interface Props {
    fileName: string;
    info: BackupInfo | null;
    checking: boolean;
    busy: boolean;
    error: string | null;
    snapshots: AutoBackup[];
    snapshotsLoading: boolean;
    snapshotsError: string | null;
    onClose: () => void;
    onConfirm: () => void;
    onChooseFile: () => void;
    onSelectSnapshot: (path: string) => void;
  }

  const {
    fileName,
    info,
    checking,
    busy,
    error,
    snapshots,
    snapshotsLoading,
    snapshotsError,
    onClose,
    onConfirm,
    onChooseFile,
    onSelectSnapshot,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
</script>

<Modal
    label={i18n.t("restore.title")}
    onClose={onClose} busy={busy}
    panel="w-full max-w-md rounded-2xl border border-line bg-surface-raised p-5"
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
    {:else if checking}
      <p class="mt-2 text-sm text-fg-muted" role="status">
        {i18n.t("restore.checking")}
      </p>
    {:else if info !== null}
      <p class="mt-1 text-sm text-fg-muted">
        {i18n.t("restore.summary", {
          file: fileName,
          clippings: countText(i18n.locale, "clipping", info.clippings),
          books: countText(i18n.locale, "book", info.books),
          tags: countText(i18n.locale, "tag", info.tags),
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
    {:else}
      <p class="mt-1 text-xs font-medium tracking-wide text-fg-muted uppercase">
        {i18n.t("restore.listTitle")}
      </p>

      {#if snapshotsLoading}
        <p class="mt-2 text-sm text-fg-muted" role="status">
          {i18n.t("restore.loading")}
        </p>
      {:else if snapshotsError}
        <p class="mt-2 text-sm text-danger" role="alert">{snapshotsError}</p>
      {:else if snapshots.length === 0}
        <p class="mt-2 text-sm text-fg-muted">{i18n.t("restore.empty")}</p>
      {:else}
        <ul class="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
          {#each snapshots as snapshot (snapshot.path)}
            <li>
              <button
                type="button"
                onclick={() => onSelectSnapshot(snapshot.path)}
                disabled={busy}
                aria-label={i18n.t("restore.use", { file: snapshot.name })}
                class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-hover disabled:opacity-50"
              >
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-fg">{autoBackupDate(snapshot.name)}</span>
                  <span class="block truncate text-[10px] text-fg-subtle">{snapshot.name}</span>
                </span>
                <span class="shrink-0 text-[10px] text-fg-muted">
                  {formatBackupSize(snapshot.size)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onclick={onClose}
          disabled={busy}
          class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
        >
          {i18n.t("restore.close")}
        </button>
        <button
          type="button"
          onclick={onChooseFile}
          disabled={busy || checking}
          class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
        >
          {i18n.t("restore.chooseFile")}
        </button>
      </div>
    {/if}
</Modal>
