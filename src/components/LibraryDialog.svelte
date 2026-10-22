<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { ImportedFile, RenameBookResult } from "../lib/db";
  import type { Book } from "../lib/types";

  interface Props {
    books: Book[];
    files: ImportedFile[];
    busy: boolean;
    status: string | null;
    error: string | null;
    onClose: () => void;
    onRename: (bookId: number, title: string, author: string) => Promise<RenameBookResult | null>;
    onMerge: (sourceId: number, targetId: number) => Promise<boolean>;
    onDeleteBook: (book: Book) => Promise<boolean>;
    onRemoveFile: (file: ImportedFile) => Promise<boolean>;
  }

  const {
    books,
    files,
    busy,
    status,
    error,
    onClose,
    onRename,
    onMerge,
    onDeleteBook,
    onRemoveFile,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  let tab = $state<"books" | "files">("books");
  let localBusy = $state(false);
  let renameId = $state<number | null>(null);
  let titleDraft = $state("");
  let authorDraft = $state("");
  let mergeSourceId = $state<number | null>(null);
  let mergeTargetId = $state<number | null>(null);
  let mergeOffer = $state<{ sourceId: number; targetId: number } | null>(null);
  let deleteTarget = $state<Book | null>(null);
  let removeTarget = $state<ImportedFile | null>(null);

  const working = $derived(busy || localBusy);
  const mergeTargets = $derived(books.filter((book) => book.id !== mergeSourceId));
  const dateFormatter = $derived(
    new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }),
  );

  function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
  }

  function startRename(book: Book): void {
    renameId = book.id;
    titleDraft = book.title;
    authorDraft = book.author ?? "";
    mergeSourceId = null;
    mergeTargetId = null;
    mergeOffer = null;
    deleteTarget = null;
    removeTarget = null;
  }

  function cancelRowActions(): void {
    renameId = null;
    mergeSourceId = null;
    mergeTargetId = null;
    mergeOffer = null;
    deleteTarget = null;
    removeTarget = null;
  }

  async function saveRename(): Promise<void> {
    if (renameId === null) return;
    localBusy = true;
    try {
      const result = await onRename(renameId, titleDraft, authorDraft);
      if (result === null) return;
      if (result.status === "merge-required") {
        mergeOffer = { sourceId: renameId, targetId: result.existingBookId };
        renameId = null;
        return;
      }
      if (result.status === "renamed") {
        cancelRowActions();
      }
    } finally {
      localBusy = false;
    }
  }

  async function confirmMergeOffer(): Promise<void> {
    if (!mergeOffer) return;
    localBusy = true;
    try {
      if (await onMerge(mergeOffer.sourceId, mergeOffer.targetId)) {
        mergeOffer = null;
      }
    } finally {
      localBusy = false;
    }
  }

  function startMerge(book: Book): void {
    mergeSourceId = book.id;
    mergeTargetId = null;
    renameId = null;
    deleteTarget = null;
    removeTarget = null;
  }

  async function confirmMerge(): Promise<void> {
    if (mergeSourceId === null || mergeTargetId === null) return;
    localBusy = true;
    try {
      if (await onMerge(mergeSourceId, mergeTargetId)) {
        mergeSourceId = null;
        mergeTargetId = null;
      }
    } finally {
      localBusy = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    localBusy = true;
    try {
      if (await onDeleteBook(deleteTarget)) {
        deleteTarget = null;
      }
    } finally {
      localBusy = false;
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!removeTarget) return;
    localBusy = true;
    try {
      if (await onRemoveFile(removeTarget)) {
        removeTarget = null;
      }
    } finally {
      localBusy = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={i18n.t("library.cancel")}
    disabled={working}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("library.title")}
    tabindex="-1"
    class="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900"
  >
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {i18n.t("library.title")}
      </h2>
      <button
        type="button"
        onclick={onClose}
        disabled={working}
        aria-label={i18n.t("library.cancel")}
        class="rounded-full px-2 text-lg leading-none text-neutral-400 transition hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-200"
      >
        ×
      </button>
    </div>

    <div class="mt-3 flex items-center gap-1.5" role="group" aria-label={i18n.t("library.title")}>
      <button
        type="button"
        onclick={() => (tab = "books")}
        aria-pressed={tab === "books"}
        class="rounded-full border px-3 py-1.5 text-xs font-medium transition {tab === 'books'
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
          : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
      >
        {i18n.t("library.books")}
      </button>
      <button
        type="button"
        onclick={() => (tab = "files")}
        aria-pressed={tab === "files"}
        class="rounded-full border px-3 py-1.5 text-xs font-medium transition {tab === 'files'
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
          : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
      >
        {i18n.t("library.files")}
      </button>
    </div>

    {#if status}
      <p class="mt-3 text-xs text-emerald-700 dark:text-emerald-400" role="status">{status}</p>
    {/if}
    {#if error}
      <p class="mt-3 text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>
    {/if}

    <div class="mt-3 min-h-0 flex-1 overflow-y-auto">
      {#if tab === "books"}
        <ul class="space-y-1">
          {#each books as book (book.id)}
            <li class="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
              {#if renameId === book.id}
                <form
                  class="flex flex-wrap items-end gap-2"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void saveRename();
                  }}
                >
                  <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {i18n.t("library.bookTitle")}
                    <input
                      bind:value={titleDraft}
                      required
                      disabled={working}
                      class="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    />
                  </label>
                  <label class="flex min-w-32 flex-1 flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {i18n.t("library.bookAuthor")}
                    <input
                      bind:value={authorDraft}
                      disabled={working}
                      class="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={working}
                    class="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    {i18n.t("library.save")}
                  </button>
                  <button
                    type="button"
                    onclick={cancelRowActions}
                    disabled={working}
                    class="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {i18n.t("library.cancel")}
                  </button>
                </form>
              {:else}
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm text-neutral-900 dark:text-neutral-100" title={book.title}>
                      {book.title}
                    </p>
                    {#if book.author}
                      <p class="truncate text-xs text-neutral-500 dark:text-neutral-400" title={book.author}>
                        {book.author}
                      </p>
                    {/if}
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      {i18n.t("library.clippingCount", { count: book.clipping_count })}
                    </span>
                    <button
                      type="button"
                      onclick={() => startRename(book)}
                      disabled={working}
                      class="rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {i18n.t("library.rename")}
                    </button>
                    <button
                      type="button"
                      onclick={() => startMerge(book)}
                      disabled={working || books.length < 2}
                      class="rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {i18n.t("library.merge")}
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        deleteTarget = book;
                        renameId = null;
                        mergeSourceId = null;
                        mergeTargetId = null;
                        removeTarget = null;
                      }}
                      disabled={working}
                      class="rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      {i18n.t("library.delete")}
                    </button>
                  </div>
                </div>

                {#if mergeSourceId === book.id}
                  <div class="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                    <label class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      {i18n.t("library.mergeTarget")}
                      <select
                        bind:value={mergeTargetId}
                        disabled={working}
                        class="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                      >
                        <option value={null} disabled>—</option>
                        {#each mergeTargets as target (target.id)}
                          <option value={target.id}>{target.title}</option>
                        {/each}
                      </select>
                    </label>
                    <button
                      type="button"
                      onclick={confirmMerge}
                      disabled={working || mergeTargetId === null}
                      class="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {i18n.t("library.merge")}
                    </button>
                    <button
                      type="button"
                      onclick={cancelRowActions}
                      disabled={working}
                      class="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {i18n.t("library.cancel")}
                    </button>
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        {#if files.length === 0}
          <p class="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
            {i18n.t("library.emptyFiles")}
          </p>
        {:else}
          <ul class="space-y-1">
            {#each files as file (file.id)}
              <li class="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
                <div class="min-w-0">
                  <p class="truncate text-sm text-neutral-900 dark:text-neutral-100" title={file.path}>
                    {file.path}
                  </p>
                  <p class="text-xs text-neutral-500 dark:text-neutral-400">
                    {i18n.t("library.importedAt", { date: formatDate(file.imported_at) })} ·
                    {i18n.t("library.clippingCount", { count: file.clipping_count })}
                  </p>
                </div>
                <button
                  type="button"
                  onclick={() => {
                    removeTarget = file;
                    deleteTarget = null;
                  }}
                  disabled={working}
                  class="shrink-0 rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {i18n.t("library.remove")}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    {#if mergeOffer}
      <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
        <p class="text-sm text-amber-800 dark:text-amber-200">{i18n.t("library.mergeRequired")}</p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (mergeOffer = null)}
            disabled={working}
            class="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-40 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={confirmMergeOffer}
            disabled={working}
            class="rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-40"
          >
            {i18n.t("library.mergeInto")}
          </button>
        </div>
      </div>
    {/if}

    {#if deleteTarget}
      <div class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
        <p class="text-sm text-red-800 dark:text-red-200">
          {i18n.t("library.confirmDelete", {
            title: deleteTarget.title,
            count: deleteTarget.clipping_count,
          })}
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (deleteTarget = null)}
            disabled={working}
            class="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100 disabled:opacity-40 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={confirmDelete}
            disabled={working}
            class="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {i18n.t("library.delete")}
          </button>
        </div>
      </div>
    {/if}

    {#if removeTarget}
      <div class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
        <p class="text-sm text-red-800 dark:text-red-200">
          {i18n.t("library.confirmRemove", {
            path: removeTarget.path,
            count: removeTarget.clipping_count,
          })}
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (removeTarget = null)}
            disabled={working}
            class="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100 disabled:opacity-40 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={confirmRemove}
            disabled={working}
            class="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {i18n.t("library.remove")}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
