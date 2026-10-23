<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { formatAddedOn, formatReference, tagOverflow } from "../lib/library";
  import type { ClippingRow, Tag } from "../lib/types";

  interface Props {
    clipping: ClippingRow;
    allTags: Tag[];
    copied: boolean;
    onToggleFavorite: (id: number) => void;
    onCopy: (id: number) => void;
    onEdit: (id: number, content: string) => Promise<boolean>;
    onRequestReset: (id: number) => void;
    onAddTag: (id: number, name: string) => Promise<boolean>;
    onRemoveTag: (id: number, tagId: number) => Promise<boolean>;
  }

  const {
    clipping,
    allTags,
    copied,
    onToggleFavorite,
    onCopy,
    onEdit,
    onRequestReset,
    onAddTag,
    onRemoveTag,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const reference = $derived(formatReference(clipping.page, clipping.location));
  const kindLabel = $derived(i18n.t(`kind.${clipping.kind}`));
  const addedOnLabel = $derived(
    formatAddedOn(clipping.added_on, clipping.added_on_raw, i18n.locale),
  );

  const edited = $derived(clipping.content_edited !== null);
  const editedOnLabel = $derived(
    clipping.edited_at === null ? "" : formatAddedOn(clipping.edited_at, "", i18n.locale),
  );
  const displayContent = $derived(clipping.content_edited ?? clipping.content);
  const canEdit = $derived(clipping.kind === "note");

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);

  let tagsExpanded = $state(false);
  let tagFormOpen = $state(false);
  let tagDraft = $state("");
  let tagSaving = $state(false);
  let tagInput = $state<HTMLInputElement | null>(null);

  const chips = $derived(tagOverflow(clipping.tags));
  const visibleTags = $derived(tagsExpanded ? clipping.tags : chips.visible);
  const tagDraftTrimmed = $derived(tagDraft.trim());
  const suggestions = $derived(
    tagDraftTrimmed === ""
      ? []
      : allTags
          .filter(
            (tag) =>
              !clipping.tags.some(
                (own) => own.name.toLowerCase() === tag.name.toLowerCase(),
              ),
          )
          .filter((tag) => tag.name.toLowerCase().includes(tagDraftTrimmed.toLowerCase()))
          .slice(0, 6),
  );

  $effect(() => {
    if (tagFormOpen) {
      tagInput?.focus();
    }
  });

  function toggleTagForm(): void {
    tagFormOpen = !tagFormOpen;
    if (!tagFormOpen) {
      tagDraft = "";
    }
  }

  async function submitTag(name: string): Promise<void> {
    const clean = name.trim();
    if (clean === "" || tagSaving) {
      return;
    }
    tagSaving = true;
    try {
      if (await onAddTag(clipping.id, clean)) {
        tagDraft = "";
        tagFormOpen = false;
      }
    } finally {
      tagSaving = false;
    }
  }

  function onTagKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      tagFormOpen = false;
      tagDraft = "";
    }
  }

  function startEditing(): void {
    draft = displayContent ?? "";
    editing = true;
  }

  async function save(): Promise<void> {
    saving = true;
    try {
      if (await onEdit(clipping.id, draft)) {
        editing = false;
      }
    } finally {
      saving = false;
    }
  }
</script>

<article
  class="clipping-card rounded-2xl border border-neutral-200 bg-white p-5 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
>
  {#if editing}
    <textarea
      bind:value={draft}
      rows="4"
      class="w-full resize-y rounded-xl border border-amber-400 bg-amber-50/50 p-3 text-[15px] leading-relaxed text-neutral-800 outline-none focus:border-amber-500 dark:border-amber-600 dark:bg-neutral-800 dark:text-neutral-200"
    ></textarea>
    <div class="mt-2 flex items-center gap-2">
      <button
        type="button"
        onclick={save}
        disabled={saving}
        class="rounded-full bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:opacity-80 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {i18n.t("card.save")}
      </button>
      <button
        type="button"
        onclick={() => (editing = false)}
        disabled={saving}
        class="rounded-full border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {i18n.t("card.cancel")}
      </button>
    </div>
  {:else if displayContent}
    <blockquote
      class="border-l-2 border-amber-400 pl-4 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200"
    >
      {displayContent}
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
    {#each visibleTags as tag (tag.id)}
      <span
        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
      >
        <span>#{tag.name}</span>
        <button
          type="button"
          onclick={() => onRemoveTag(clipping.id, tag.id)}
          aria-label={i18n.t("card.removeTag", { name: tag.name })}
          title={i18n.t("card.removeTag", { name: tag.name })}
          class="-mr-0.5 rounded-full px-0.5 text-sm leading-none text-amber-500 transition hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
        >
          ×
        </button>
      </span>
    {/each}
    {#if chips.hidden > 0}
      <button
        type="button"
        onclick={() => (tagsExpanded = !tagsExpanded)}
        aria-expanded={tagsExpanded}
        aria-label={tagsExpanded
          ? i18n.t("card.showFewerTags")
          : i18n.t("card.showMoreTags", { count: chips.hidden })}
        title={tagsExpanded
          ? i18n.t("card.showFewerTags")
          : i18n.t("card.showMoreTags", { count: chips.hidden })}
        class="rounded-full border border-dashed border-neutral-300 px-2 py-0.5 font-medium text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        {tagsExpanded ? "−" : `+${chips.hidden}`}
      </button>
    {/if}
    {#if edited && !editing}
      <span
        class="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        title={editedOnLabel}
      >
        {i18n.t("card.edited")}
      </span>
    {/if}
    {#if reference !== ""}
      <span>{reference}</span>
    {/if}
    <span>{addedOnLabel}</span>
    <span class="flex-1"></span>
    {#if !editing}
      {#if canEdit}
        <button
          type="button"
          onclick={startEditing}
          aria-label={i18n.t("card.edit")}
          title={i18n.t("card.edit")}
          class="rounded-full p-1.5 text-base leading-none transition text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-300"
        >
          ✎
        </button>
      {/if}
      {#if edited}
        <button
          type="button"
          onclick={() => onRequestReset(clipping.id)}
          aria-label={i18n.t("card.reset")}
          title={i18n.t("card.reset")}
          class="rounded-full p-1.5 text-base leading-none transition text-neutral-300 hover:text-amber-500 dark:text-neutral-600 dark:hover:text-amber-400"
        >
          ↺
        </button>
      {/if}
      {#if displayContent}
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
    {/if}
    <button
      type="button"
      onclick={toggleTagForm}
      aria-label={i18n.t("card.addTag")}
      aria-expanded={tagFormOpen}
      title={i18n.t("card.addTag")}
      class="rounded-full p-1.5 text-base leading-none transition {tagFormOpen
        ? 'text-amber-500'
        : 'text-neutral-300 hover:text-amber-400 dark:text-neutral-600 dark:hover:text-amber-400'}"
    >
      #
    </button>
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

  {#if tagFormOpen}
    <form
      class="mt-2"
      onsubmit={(event) => {
        event.preventDefault();
        void submitTag(tagDraft);
      }}
    >
      <input
        bind:this={tagInput}
        bind:value={tagDraft}
        onkeydown={onTagKeydown}
        placeholder={i18n.t("card.tagPlaceholder")}
        aria-label={i18n.t("card.tagPlaceholder")}
        disabled={tagSaving}
        class="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3 py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-amber-500 disabled:opacity-60 dark:border-amber-700 dark:bg-neutral-800 dark:text-neutral-200"
      />
      {#if suggestions.length > 0}
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#each suggestions as suggestion (suggestion.id)}
            <button
              type="button"
              onclick={() => submitTag(suggestion.name)}
              disabled={tagSaving}
              class="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              #{suggestion.name}
            </button>
          {/each}
        </div>
      {/if}
    </form>
  {/if}
</article>
