<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { selectOnInteraction } from "../lib/focus";
  import { formatAddedOn, referenceText } from "../lib/format";
  import { formatReminderAt } from "../lib/reminders";
  import { tagOverflow } from "../lib/library";
  import type { ClippingKind, ClippingRow, Tag } from "../lib/types";
  import HighlightedText from "./HighlightedText.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    clipping: ClippingRow;
    allTags: Tag[];
    copied: boolean;
    quoted: boolean;
    /** Search query that produced the visible list, for highlight marks. */
    query: string;
    /** Pending reminder for this clipping (ISO UTC), or null. */
    reminderAt: string | null;
    /** Click or focus inside the card makes it the keyboard selection. */
    onSelect: (id: number) => void;
    onOpen: (id: number) => void;
    onToggleFavorite: (id: number) => void;
    onCopy: (id: number) => void;
    onCopyQuote: (id: number) => void;
    onEdit: (id: number, content: string) => Promise<boolean>;
    onRequestReset: (id: number) => void;
    onAddTag: (id: number, name: string) => Promise<boolean>;
    onRemoveTag: (id: number, tagId: number) => Promise<boolean>;
    onFilterByTag: (tagId: number) => void;
    onFilterByKind: (kind: ClippingKind) => void;
    onFilterEdited: () => void;
    onRemind: (id: number) => void;
  }

  const {
    clipping,
    allTags,
    copied,
    quoted,
    query,
    reminderAt,
    onSelect,
    onOpen,
    onToggleFavorite,
    onCopy,
    onCopyQuote,
    onEdit,
    onRequestReset,
    onAddTag,
    onRemoveTag,
    onFilterByTag,
    onFilterByKind,
    onFilterEdited,
    onRemind,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const reference = $derived(referenceText(i18n.t, clipping.page, clipping.location));
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
      event.stopPropagation();
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
  data-clipping-id={clipping.id}
  tabindex="-1"
  use:selectOnInteraction={() => onSelect(clipping.id)}
  class="clipping-card rounded-2xl border border-line bg-surface-raised p-[var(--card-padding)] transition-colors hover:border-line-strong"
>
  <div class="flex items-start gap-2.5">
    <div class="min-w-0 flex-1">
      {#if editing}
        <textarea
          bind:value={draft}
          rows="4"
          class="w-full resize-y rounded-xl border border-accent bg-accent-soft/50 p-3 text-[15px] leading-relaxed text-fg outline-none focus:border-accent"
        ></textarea>
        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            onclick={save}
            disabled={saving}
            class="rounded-full bg-inverse px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:opacity-80 disabled:opacity-50"
          >
            {i18n.t("card.save")}
          </button>
          <button
            type="button"
            onclick={() => (editing = false)}
            disabled={saving}
            class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
          >
            {i18n.t("card.cancel")}
          </button>
        </div>
      {:else if displayContent}
        <blockquote
          class="border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-fg"
        >
          <HighlightedText text={displayContent} {query} />
        </blockquote>
      {:else}
        <p class="text-sm text-fg-subtle italic">
          {i18n.t("card.noText", { kind: kindLabel })}
        </p>
      {/if}
    </div>

    <button
      type="button"
      onclick={() => onToggleFavorite(clipping.id)}
      aria-label={clipping.favorite ? i18n.t("card.unfav") : i18n.t("card.fav")}
      aria-pressed={clipping.favorite}
      title={clipping.favorite ? i18n.t("card.unfav") : i18n.t("card.fav")}
      class="-mr-1 -mt-1 grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface {clipping.favorite
        ? 'text-accent hover:text-accent-hover'
        : 'text-fg-muted hover:text-fg'}"
    >
      <Icon name="star" filled={clipping.favorite} class="h-5 w-5" />
    </button>
  </div>

  <div class="mt-[var(--card-section-gap)] text-sm">
    <span class="block font-medium text-fg"><HighlightedText text={clipping.title} {query} /></span>
    {#if clipping.author}
      <span class="block text-fg-muted"><HighlightedText text={clipping.author} {query} /></span>
    {/if}
  </div>

  <div class="mt-[var(--card-meta-gap)] flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
    <button
      type="button"
      onclick={(event) => {
        event.stopPropagation();
        onFilterByKind(clipping.kind);
      }}
      aria-label={i18n.t("card.filterByKind", { kind: kindLabel })}
      title={i18n.t("card.filterByKind", { kind: kindLabel })}
      class="rounded-full bg-surface-hover px-2.5 py-0.5 font-medium text-fg-muted transition hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
    >
      {kindLabel}
    </button>
    {#if edited && !editing}
      <button
        type="button"
        onclick={(event) => {
          event.stopPropagation();
          onFilterEdited();
        }}
        aria-label={i18n.t("card.filterEdited")}
        title={editedOnLabel === ""
          ? i18n.t("card.filterEdited")
          : `${i18n.t("card.filterEdited")} · ${editedOnLabel}`}
        class="rounded-full bg-accent-soft-strong px-2.5 py-0.5 font-medium text-accent-text transition hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
      >
        {i18n.t("card.edited")}
      </button>
    {/if}
    {#each visibleTags as tag (tag.id)}
      <span
        class="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-text"
      >
        <button
          type="button"
          onclick={(event) => {
            event.stopPropagation();
            onFilterByTag(tag.id);
          }}
          aria-label={i18n.t("card.filterByTag", { name: tag.name })}
          title={i18n.t("card.filterByTag", { name: tag.name })}
          class="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
        >
          <span>#{tag.name}</span>
        </button>
        <button
          type="button"
          onclick={(event) => {
            event.stopPropagation();
            onRemoveTag(clipping.id, tag.id);
          }}
          aria-label={i18n.t("card.removeTag", { name: tag.name })}
          title={i18n.t("card.removeTag", { name: tag.name })}
          class="-mr-0.5 grid h-4 w-4 place-items-center rounded-full text-accent-text transition hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
        >
          <Icon name="close" class="h-3 w-3" />
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
        class="rounded-full border border-dashed border-line-strong px-2 py-0.5 font-medium text-fg-muted transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
      >
        {tagsExpanded ? "−" : `+${chips.hidden}`}
      </button>
    {/if}
    <button
      type="button"
      onclick={toggleTagForm}
      aria-label={i18n.t("card.addTag")}
      aria-expanded={tagFormOpen}
      title={i18n.t("card.addTag")}
      class="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface {tagFormOpen
        ? 'border-accent bg-accent-soft text-accent-text'
        : 'border-line-strong text-fg-muted hover:bg-surface-hover hover:text-fg'}"
    >
      <Icon name="plus" class="h-3 w-3" />
      {i18n.t("card.tagChip")}
    </button>
    {#if reference !== ""}
      <span class="text-fg-faint" aria-hidden="true">·</span>
      <span>{reference}</span>
    {/if}
    <span class="text-fg-faint" aria-hidden="true">·</span>
    <span class="text-fg-subtle">{addedOnLabel}</span>
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
        class="w-full rounded-xl border border-accent/40 bg-accent-soft/40 px-3 py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent disabled:opacity-60"
      />
      {#if suggestions.length > 0}
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#each suggestions as suggestion (suggestion.id)}
            <button
              type="button"
              onclick={() => submitTag(suggestion.name)}
              disabled={tagSaving}
              class="rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted transition hover:bg-surface-hover disabled:opacity-50"
            >
              #{suggestion.name}
            </button>
          {/each}
        </div>
      {/if}
    </form>
  {/if}

  {#if !editing}
    <div class="mt-2 flex items-center gap-2 border-t border-line-subtle pt-2">
      <button
        type="button"
        onclick={() => onOpen(clipping.id)}
        title={i18n.t("reading.open")}
        class="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] px-2.5 text-[13.5px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
      >
        <Icon name="bookOpen" class="h-[18px] w-[18px]" />
        {i18n.t("card.read")}
      </button>
      {#if canEdit}
        <button
          type="button"
          onclick={startEditing}
          aria-label={i18n.t("card.edit")}
          title={i18n.t("card.edit")}
          class="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
        >
          <Icon name="edit" class="h-[18px] w-[18px]" />
        </button>
      {/if}
      {#if edited}
        <button
          type="button"
          onclick={() => onRequestReset(clipping.id)}
          aria-label={i18n.t("card.reset")}
          title={i18n.t("card.reset")}
          class="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface"
        >
          <Icon name="restore" class="h-[18px] w-[18px]" />
        </button>
      {/if}
      <button
        type="button"
        onclick={() => onRemind(clipping.id)}
        aria-label={reminderAt
          ? i18n.t("card.reminderAt", { date: formatReminderAt(reminderAt, i18n.locale) })
          : i18n.t("card.remind")}
        aria-pressed={reminderAt !== null}
        title={reminderAt
          ? i18n.t("card.reminderAt", { date: formatReminderAt(reminderAt, i18n.locale) })
          : i18n.t("card.remind")}
        class="ml-auto grid h-[34px] w-[34px] place-items-center rounded-[10px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface {reminderAt
          ? 'text-accent hover:text-accent-hover'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}"
      >
        <Icon name="bell" filled={reminderAt !== null} class="h-[18px] w-[18px]" />
      </button>
      {#if displayContent}
        <!-- One object, two real buttons: the shared well groups the two copies
             without turning them into a menu. The hairline is a ring, not a
             border, so the pill stays as tall as the halves plus 1 px. -->
        <div
          class="inline-flex items-center gap-0.5 rounded-xl bg-surface-inset p-px ring-1 ring-line-strong/50"
        >
          <button
            type="button"
            onclick={() => onCopy(clipping.id)}
            aria-label={i18n.t("card.copy")}
            title={copied ? i18n.t("card.copied") : i18n.t("card.copy")}
            class="grid h-8 w-8 place-items-center rounded-[9px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent {copied
              ? 'text-success'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}"
          >
            <Icon name={copied ? "check" : "copy"} class="h-[17px] w-[17px]" />
          </button>
          <span class="h-4 w-px bg-line-strong/60" aria-hidden="true"></span>
          <button
            type="button"
            onclick={() => onCopyQuote(clipping.id)}
            aria-label={i18n.t("card.copyQuote")}
            title={quoted ? i18n.t("card.quoteCopied") : i18n.t("card.copyQuote")}
            class="grid h-8 w-8 place-items-center rounded-[9px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent {quoted
              ? 'text-success'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}"
          >
            <Icon name={quoted ? "check" : "quote"} class="h-[17px] w-[17px]" />
          </button>
        </div>
      {/if}
    </div>
  {/if}

</article>
