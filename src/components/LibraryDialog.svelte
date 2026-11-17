<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext, countText } from "../lib/i18n";
  import { ScrollFade } from "../lib/scrollFade.svelte";
  import Modal from "./Modal.svelte";
  import ScrollFadeOverlay from "./ScrollFadeOverlay.svelte";
  import { filterBooks } from "../lib/library";
  import { RowActions, type RenameOutcome } from "../lib/app/rowActions.svelte";
  import type { ImportedFile, RenameBookResult, RenameTagResult, TagCount } from "../lib/db";
  import type { Book } from "../lib/types";

  interface Props {
    books: Book[];
    files: ImportedFile[];
    tags: TagCount[];
    busy: boolean;
    status: string | null;
    error: string | null;
    onClose: () => void;
    onRename: (bookId: number, title: string, author: string) => Promise<RenameBookResult | null>;
    onMerge: (sourceId: number, targetId: number) => Promise<boolean>;
    onDeleteBook: (book: Book) => Promise<boolean>;
    onRemoveFile: (file: ImportedFile) => Promise<boolean>;
    onRenameTag: (tagId: number, name: string) => Promise<RenameTagResult | null>;
    onMergeTags: (sourceId: number, targetId: number) => Promise<boolean>;
    onDeleteTag: (tag: TagCount) => Promise<boolean>;
  }

  const {
    books,
    files,
    tags,
    busy,
    status,
    error,
    onClose,
    onRename,
    onMerge,
    onDeleteBook,
    onRemoveFile,
    onRenameTag,
    onMergeTags,
    onDeleteTag,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  let tab = $state<"books" | "files" | "tags">("books");
  let bookFilter = $state("");
  let removeFileTarget = $state<ImportedFile | null>(null);
  let fileBusy = $state(false);

  interface BookDraft {
    title: string;
    author: string;
  }

  interface TagDraft {
    name: string;
  }

  /** Both lists run the same rename/merge/delete flow; only the writes differ. */
  const bookActions = new RowActions<Book, BookDraft>({
    draftOf: (book) => ({ title: book.title, author: book.author ?? "" }),
    rename: async (book, draft) => toOutcome(await onRename(book.id, draft.title, draft.author)),
    merge: (sourceId, targetId) => onMerge(sourceId, targetId),
    remove: (book) => onDeleteBook(book),
    // A closed book panel also closes the file removal it used to sit next to.
    onCancel: () => {
      removeFileTarget = null;
    },
  });
  const tagActions = new RowActions<TagCount, TagDraft>({
    draftOf: (tag) => ({ name: tag.name }),
    rename: async (tag, draft) => toOutcome(await onRenameTag(tag.id, draft.name)),
    merge: (sourceId, targetId) => onMergeTags(sourceId, targetId),
    remove: (tag) => onDeleteTag(tag),
    // Same rule as the book list: its panels sit next to the file removal.
    onCancel: () => {
      removeFileTarget = null;
    },
  });

  /** The panel reports `merge-required` with its own field name per entity. */
  function toOutcome(result: RenameBookResult | RenameTagResult | null): RenameOutcome | null {
    if (result === null || result.status !== "merge-required") {
      return result;
    }
    return {
      status: "merge-required",
      existingId: "existingBookId" in result ? result.existingBookId : result.existingTagId,
    };
  }

  const working = $derived(busy || bookActions.busy || tagActions.busy || fileBusy);
  const filteredBooks = $derived(filterBooks(books, bookFilter));
  const mergeTargets = $derived(books.filter((book) => book.id !== bookActions.mergeSourceId));
  const tagMergeTargets = $derived(tags.filter((tag) => tag.id !== tagActions.mergeSourceId));
  const bookMergeOffer = $derived(bookActions.mergeOffer);
  const bookDeleteTarget = $derived(bookActions.deleteTarget);
  const tagMergeOffer = $derived(tagActions.mergeOffer);
  const tagDeleteTarget = $derived(tagActions.deleteTarget);
  const dateFormatter = $derived(
    new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }),
  );

  /** Bottom fade of the list, measured against the scroller. */
  const fade = new ScrollFade();

  function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
  }

  /** Book actions sit next to the file list: starting one closes its panel. */
  function startBookRename(book: Book): void {
    removeFileTarget = null;
    bookActions.startRename(book);
  }

  function startBookMerge(book: Book): void {
    removeFileTarget = null;
    bookActions.startMerge(book);
  }

  function startBookDelete(book: Book): void {
    removeFileTarget = null;
    bookActions.startDelete(book);
  }

  function startFileRemove(file: ImportedFile): void {
    bookActions.deleteTarget = null;
    tagActions.deleteTarget = null;
    removeFileTarget = file;
  }

  /** Tag actions follow the book ones: starting one closes the file panel. */
  function startTagRename(tag: TagCount): void {
    removeFileTarget = null;
    tagActions.startRename(tag);
  }

  function startTagMerge(tag: TagCount): void {
    removeFileTarget = null;
    tagActions.startMerge(tag);
  }

  function startTagDelete(tag: TagCount): void {
    removeFileTarget = null;
    tagActions.startDelete(tag);
  }

  async function confirmRemoveFile(): Promise<void> {
    const target = removeFileTarget;
    if (target === null || fileBusy) return;
    fileBusy = true;
    try {
      if (await onRemoveFile(target)) {
        removeFileTarget = null;
      }
    } finally {
      fileBusy = false;
    }
  }
</script>

<Modal
    label={i18n.t("library.title")}
    onClose={onClose} busy={working}
    panel="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface-raised p-5"
  >
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-sm font-medium text-fg">
        {i18n.t("library.title")}
      </h2>
      <button
        type="button"
        onclick={onClose}
        disabled={working}
        aria-label={i18n.t("library.cancel")}
        class="rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg disabled:opacity-40"
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
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("library.books")}
      </button>
      <button
        type="button"
        onclick={() => (tab = "files")}
        aria-pressed={tab === "files"}
        class="rounded-full border px-3 py-1.5 text-xs font-medium transition {tab === 'files'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("library.files")}
      </button>
      <button
        type="button"
        onclick={() => (tab = "tags")}
        aria-pressed={tab === "tags"}
        class="rounded-full border px-3 py-1.5 text-xs font-medium transition {tab === 'tags'
          ? 'border-inverse bg-inverse text-inverse-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'}"
      >
        {i18n.t("library.tags")}
      </button>
    </div>

    {#if status}
      <p class="mt-3 text-xs text-success" role="status">{status}</p>
    {/if}
    {#if error}
      <p class="mt-3 text-xs text-danger" role="alert">{error}</p>
    {/if}

    {#if tab === "books"}
      <input
        type="search"
        bind:value={bookFilter}
        placeholder={i18n.t("library.filterBooks")}
        aria-label={i18n.t("library.filterBooks")}
        class="mt-3 w-full appearance-none rounded-full border border-line bg-surface-inset px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-line-strong focus:ring-2 focus:ring-accent/30 focus:ring-inset"
      />
    {/if}

    <div class="relative mt-3 flex min-h-0 flex-1 flex-col">
      <div
        use:fade.track
        class="min-h-0 flex-1 overflow-y-auto"
      >
        {#if tab === "books"}
          {#if books.length > 0 && filteredBooks.length === 0}
            <p class="py-6 text-center text-sm text-fg-subtle">
              {i18n.t("library.emptyFilteredBooks")}
            </p>
          {/if}
          <ul class="space-y-1">
            {#each filteredBooks as book (book.id)}
              <li class="rounded-lg border border-line p-2.5">
                {#if bookActions.renameTarget?.id === book.id}
                  <form
                    class="flex flex-wrap items-end gap-2"
                    onsubmit={(event) => {
                      event.preventDefault();
                      void bookActions.saveRename();
                    }}
                  >
                    <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-fg-muted">
                      {i18n.t("library.bookTitle")}
                      <input
                        bind:value={bookActions.draft.title}
                        required
                        disabled={working}
                        class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong"
                      />
                    </label>
                    <label class="flex min-w-32 flex-1 flex-col gap-1 text-xs text-fg-muted">
                      {i18n.t("library.bookAuthor")}
                      <input
                        bind:value={bookActions.draft.author}
                        disabled={working}
                        class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={working}
                      class="rounded-full bg-inverse px-3 py-1.5 text-xs font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
                    >
                      {i18n.t("library.save")}
                    </button>
                    <button
                      type="button"
                      onclick={() => bookActions.cancel()}
                      disabled={working}
                      class="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                    >
                      {i18n.t("library.cancel")}
                    </button>
                  </form>
                {:else}
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm text-fg" title={book.title}>
                        {book.title}
                      </p>
                      {#if book.author}
                        <p class="truncate text-xs text-fg-muted" title={book.author}>
                          {book.author}
                        </p>
                      {/if}
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <span class="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                        {i18n.t("library.clippingCount", { count: book.clipping_count })}
                      </span>
                      <button
                        type="button"
                        onclick={() => startBookRename(book)}
                        disabled={working}
                        class="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                      >
                        {i18n.t("library.rename")}
                      </button>
                      <button
                        type="button"
                        onclick={() => startBookMerge(book)}
                        disabled={working || books.length < 2}
                        class="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                      >
                        {i18n.t("library.merge")}
                      </button>
                      <button
                        type="button"
                        onclick={() => startBookDelete(book)}
                        disabled={working}
                        class="rounded-full border border-danger-border px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
                      >
                        {i18n.t("library.delete")}
                      </button>
                    </div>
                  </div>

                  {#if bookActions.mergeSourceId === book.id}
                    <div class="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                      <label class="flex items-center gap-2 text-xs text-fg-muted">
                        {i18n.t("library.mergeTarget")}
                        <select
                          bind:value={bookActions.mergeTargetId}
                          disabled={working}
                          class="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg outline-none"
                        >
                          <option value={null} disabled>—</option>
                          {#each mergeTargets as target (target.id)}
                            <option value={target.id}>{target.title}</option>
                          {/each}
                        </select>
                      </label>
                      <button
                        type="button"
                        onclick={() => void bookActions.confirmMerge()}
                        disabled={working || bookActions.mergeTargetId === null}
                        class="rounded-full bg-inverse px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
                      >
                        {i18n.t("library.merge")}
                      </button>
                      <button
                        type="button"
                        onclick={() => bookActions.cancel()}
                        disabled={working}
                        class="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                      >
                        {i18n.t("library.cancel")}
                      </button>
                    </div>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
        {:else if tab === "files"}
          {#if files.length === 0}
            <p class="py-6 text-center text-sm text-fg-subtle">
              {i18n.t("library.emptyFiles")}
            </p>
          {:else}
            <ul class="space-y-1">
              {#each files as file (file.id)}
                <li class="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5">
                  <div class="min-w-0">
                    <p class="truncate text-sm text-fg" title={file.path}>
                      {file.path}
                    </p>
                    <p class="text-xs text-fg-muted">
                      {i18n.t("library.importedAt", { date: formatDate(file.imported_at) })} ·
                      {i18n.t("library.clippingCount", { count: file.clipping_count })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onclick={() => startFileRemove(file)}
                    disabled={working}
                    class="shrink-0 rounded-full border border-danger-border px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
                  >
                    {i18n.t("library.remove")}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          {#if tags.length === 0}
            <p class="py-6 text-center text-sm text-fg-subtle">
              {i18n.t("library.emptyTags")}
            </p>
          {:else}
            <ul class="space-y-1">
              {#each tags as tag (tag.id)}
                <li class="rounded-lg border border-line p-2.5">
                  {#if tagActions.renameTarget?.id === tag.id}
                    <form
                      class="flex flex-wrap items-end gap-2"
                      onsubmit={(event) => {
                        event.preventDefault();
                        void tagActions.saveRename();
                      }}
                    >
                      <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-fg-muted">
                        {i18n.t("library.tagName")}
                        <input
                          bind:value={tagActions.draft.name}
                          required
                          disabled={working}
                          class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={working}
                        class="rounded-full bg-inverse px-3 py-1.5 text-xs font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
                      >
                        {i18n.t("library.save")}
                      </button>
                      <button
                        type="button"
                        onclick={() => tagActions.cancel()}
                        disabled={working}
                        class="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                      >
                        {i18n.t("library.cancel")}
                      </button>
                    </form>
                  {:else}
                    <div class="flex items-center justify-between gap-3">
                      <p
                        class="min-w-0 truncate text-sm text-fg"
                        title={tag.name}
                      >
                        #{tag.name}
                      </p>
                      <div class="flex shrink-0 items-center gap-1">
                        <span
                          class="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {i18n.t("library.clippingCount", { count: tag.clipping_count })}
                        </span>
                        <button
                          type="button"
                          onclick={() => startTagRename(tag)}
                          disabled={working}
                          class="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                        >
                          {i18n.t("library.rename")}
                        </button>
                        <button
                          type="button"
                          onclick={() => startTagMerge(tag)}
                          disabled={working || tags.length < 2}
                          class="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                        >
                          {i18n.t("library.merge")}
                        </button>
                        <button
                          type="button"
                          onclick={() => startTagDelete(tag)}
                          disabled={working}
                          class="rounded-full border border-danger-border px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
                        >
                          {i18n.t("library.delete")}
                        </button>
                      </div>
                    </div>

                    {#if tagActions.mergeSourceId === tag.id}
                      <div
                        class="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2"
                      >
                        <label class="flex items-center gap-2 text-xs text-fg-muted">
                          {i18n.t("library.mergeTarget")}
                          <select
                            bind:value={tagActions.mergeTargetId}
                            disabled={working}
                            class="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg outline-none"
                          >
                            <option value={null} disabled>—</option>
                            {#each tagMergeTargets as target (target.id)}
                              <option value={target.id}>#{target.name}</option>
                            {/each}
                          </select>
                        </label>
                        <button
                          type="button"
                          onclick={() => void tagActions.confirmMerge()}
                          disabled={working || tagActions.mergeTargetId === null}
                          class="rounded-full bg-inverse px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-inverse/80 disabled:opacity-40"
                        >
                          {i18n.t("library.merge")}
                        </button>
                        <button
                          type="button"
                          onclick={() => tagActions.cancel()}
                          disabled={working}
                          class="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                        >
                          {i18n.t("library.cancel")}
                        </button>
                      </div>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
      <ScrollFadeOverlay
        visible={fade.moreBelow}
        class="inset-x-0 -bottom-px h-8"
      />
    </div>

    {#if bookMergeOffer}
      <div class="mt-3 rounded-lg border border-accent/30 bg-accent-soft p-3">
        <p class="text-sm text-accent-text">{i18n.t("library.mergeRequired")}</p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (bookActions.mergeOffer = null)}
            disabled={working}
            class="rounded-full border border-accent/40 px-3 py-1 text-xs font-medium text-accent-text transition hover:bg-accent-soft-strong disabled:opacity-40"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={() => void bookActions.confirmMergeOffer()}
            disabled={working}
            class="rounded-full bg-accent px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            {i18n.t("library.mergeInto")}
          </button>
        </div>
      </div>
    {/if}

    {#if bookDeleteTarget}
      <div class="mt-3 rounded-lg border border-danger-border bg-danger-soft p-3">
        <p class="text-sm text-danger">
          {i18n.t("library.confirmDelete", {
            title: bookDeleteTarget.title,
            clippings: countText(i18n.locale, "clipping", bookDeleteTarget.clipping_count),
          })}
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (bookActions.deleteTarget = null)}
            disabled={working}
            class="rounded-full border border-danger-border px-3 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={() => void bookActions.confirmDelete()}
            disabled={working}
            class="rounded-full bg-danger-solid px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover disabled:opacity-40"
          >
            {i18n.t("library.delete")}
          </button>
        </div>
      </div>
    {/if}

    {#if removeFileTarget}
      <div class="mt-3 rounded-lg border border-danger-border bg-danger-soft p-3">
        <p class="text-sm text-danger">
          {i18n.t("library.confirmRemove", {
            path: removeFileTarget.path,
            clippings: countText(i18n.locale, "clipping", removeFileTarget.clipping_count),
          })}
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (removeFileTarget = null)}
            disabled={working}
            class="rounded-full border border-danger-border px-3 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={confirmRemoveFile}
            disabled={working}
            class="rounded-full bg-danger-solid px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover disabled:opacity-40"
          >
            {i18n.t("library.remove")}
          </button>
        </div>
      </div>
    {/if}

    {#if tagMergeOffer}
      <div class="mt-3 rounded-lg border border-accent/30 bg-accent-soft p-3">
        <p class="text-sm text-accent-text">{i18n.t("library.mergeRequiredTag")}</p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (tagActions.mergeOffer = null)}
            disabled={working}
            class="rounded-full border border-accent/40 px-3 py-1 text-xs font-medium text-accent-text transition hover:bg-accent-soft-strong disabled:opacity-40"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={() => void tagActions.confirmMergeOffer()}
            disabled={working}
            class="rounded-full bg-accent px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            {i18n.t("library.tagMergeInto")}
          </button>
        </div>
      </div>
    {/if}

    {#if tagDeleteTarget}
      <div class="mt-3 rounded-lg border border-danger-border bg-danger-soft p-3">
        <p class="text-sm text-danger">
          {i18n.t("library.confirmDeleteTag", {
            name: tagDeleteTarget.name,
            clippings: countText(i18n.locale, "clipping", tagDeleteTarget.clipping_count),
          })}
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (tagActions.deleteTarget = null)}
            disabled={working}
            class="rounded-full border border-danger-border px-3 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
          >
            {i18n.t("library.cancel")}
          </button>
          <button
            type="button"
            onclick={() => void tagActions.confirmDelete()}
            disabled={working}
            class="rounded-full bg-danger-solid px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover disabled:opacity-40"
          >
            {i18n.t("library.delete")}
          </button>
        </div>
      </div>
    {/if}
</Modal>
