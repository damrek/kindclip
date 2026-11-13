<script lang="ts">
  import { getContext, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { TagCount } from "../lib/db";
  import { foldText, type AuthorGroup } from "../lib/library";
  import { hasMoreBelow } from "../lib/scroll";
  import type { ClippingKind } from "../lib/types";

  interface Props {
    /** Controlled by App so Escape closes one layer in order. */
    open?: boolean;
    authors: string[];
    authorGroups: AuthorGroup[];
    kinds: ClippingKind[];
    favoritesOnly: boolean;
    editedOnly: boolean;
    tagIds: number[];
    tags: TagCount[];
    onToggleAuthor: (key: string) => void;
    onToggleKind: (kind: ClippingKind) => void;
    onToggleFavorites: () => void;
    onToggleEdited: () => void;
    onToggleTag: (id: number) => void;
    onClear: () => void;
  }

  let {
    open = $bindable(false),
    authors,
    authorGroups,
    kinds,
    favoritesOnly,
    editedOnly,
    tagIds,
    tags,
    onToggleAuthor,
    onToggleKind,
    onToggleFavorites,
    onToggleEdited,
    onToggleTag,
    onClear,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  const KIND_OPTIONS: ClippingKind[] = ["highlight", "note", "bookmark"];

  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let wasOpen = false;

  /** Authors and tags grow with the library, so each facet gets its own search
   * and a bounded list. Kinds and status are three and two fixed rows and never
   * need either. */
  let authorQuery = $state("");
  let tagQuery = $state("");

  // Keyboard-first: the panel takes focus when opened (f) and the trigger
  // gets it back when Escape or a click closes the menu.
  $effect(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    if (!open) {
      // A closed panel starts from the full list the next time it opens, with
      // the fade back on its first row.
      authorQuery = "";
      tagQuery = "";
      authorsAtEnd = false;
      tagsAtEnd = false;
    }
    void tick().then(() => {
      if (open) {
        panel?.focus();
      } else {
        trigger?.focus();
      }
    });
  });

  /** Accent- and case-insensitive containment, folded like the sidebar. */
  function matches(label: string, query: string): boolean {
    const needle = foldText(query.trim());
    return needle === "" || foldText(label).includes(needle);
  }

  const unknownAuthor = $derived(i18n.t("filters.unknownAuthor"));

  const visibleAuthors = $derived(
    authorGroups.filter((group) => matches(group.name ?? unknownAuthor, authorQuery)),
  );
  // Tags render with a leading "#", so typing one should still match.
  const visibleTags = $derived(
    tags.filter((tag) => matches(tag.name, tagQuery.replace(/^#/, ""))),
  );

  let authorsList = $state<HTMLDivElement | null>(null);
  let tagsList = $state<HTMLDivElement | null>(null);
  /** True once the list sits on its last row; the fade then steps aside. */
  let authorsAtEnd = $state(false);
  let tagsAtEnd = $state(false);

  /** Rows the bounded lists show (`max-h-40` = 5 rows of `py-1.5` + `text-sm`,
   * 32px each, measured in the browser). The fade starts from the row count so
   * the first paint already carries it: deriving it from a DOM measurement
   * would light it one frame late and fade it in. */
  const VISIBLE_ROWS = 5;

  const authorsMore = $derived(visibleAuthors.length > VISIBLE_ROWS && !authorsAtEnd);
  const tagsMore = $derived(visibleTags.length > VISIBLE_ROWS && !tagsAtEnd);

  /** A list is at its end when nothing scrolls below the fold. */
  function scrolledToEnd(element: HTMLDivElement | null): boolean {
    return element !== null && !hasMoreBelow(element);
  }

  const measureAuthors = (): void => {
    authorsAtEnd = scrolledToEnd(authorsList);
  };
  const measureTags = (): void => {
    tagsAtEnd = scrolledToEnd(tagsList);
  };

  /** A new query re-lays the list out, so the old end state no longer holds. */
  function setAuthorQuery(next: string): void {
    authorQuery = next;
    authorsAtEnd = false;
  }

  function setTagQuery(next: string): void {
    tagQuery = next;
    tagsAtEnd = false;
  }

  const activeCount = $derived(
    authors.length +
      kinds.length +
      (favoritesOnly ? 1 : 0) +
      (editedOnly ? 1 : 0) +
      tagIds.length,
  );

  function toggleMenu(): void {
    open = !open;
  }

  function close(): void {
    open = false;
  }

  function clear(): void {
    onClear();
    close();
  }
</script>

{#snippet sectionLabel(label: string, selected: number, divided: boolean)}
  <p
    class="flex items-center justify-between gap-2 px-2 pb-1 text-xs font-medium text-fg-muted {divided
      ? 'mt-1 border-t border-line-subtle pt-2'
      : 'pt-1'}"
  >
    <span class="min-w-0 truncate">{label}</span>
    {#if selected > 0}
      <span
        class="shrink-0 rounded-full bg-surface-inset px-1.5 text-[0.65rem] leading-4 tabular-nums"
      >
        {selected}
      </span>
    {/if}
  </p>
{/snippet}

{#snippet facetSearch(
  value: string,
  placeholder: string,
  onchange: (next: string) => void,
)}
  <div class="relative mb-1 px-1">
    <Icon
      name="search"
      class="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle"
    />
    <input
      type="search"
      {value}
      {placeholder}
      aria-label={placeholder}
      oninput={(event) => onchange(event.currentTarget.value)}
      class="w-full rounded-lg border border-line bg-surface-inset py-1.5 pr-7 pl-8 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-line-strong"
    />
    {#if value !== ""}
      <button
        type="button"
        onclick={() => onchange("")}
        aria-label={i18n.t("search.clear")}
        class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-1 text-fg-subtle transition hover:text-fg"
      >
        ×
      </button>
    {/if}
  </div>
{/snippet}

<div class="relative">
  <button
    type="button"
    bind:this={trigger}
    onclick={toggleMenu}
    aria-expanded={open}
    aria-haspopup="dialog"
    aria-keyshortcuts="f"
    title={i18n.t("filters.button")}
    class="flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition {activeCount >
    0
      ? 'border-inverse bg-inverse text-inverse-fg'
      : 'border-line text-fg-muted hover:bg-surface-hover'}"
  >
    <Icon name="filter" />
    <span>{i18n.t("filters.button")}</span>
    {#if activeCount > 0}
      <span class="rounded-full bg-inverse-fg/20 px-1.5 text-xs leading-4">
        {activeCount}
      </span>
    {/if}
  </button>

  {#if open}
    <button
      type="button"
      class="fixed inset-0 z-10 cursor-default"
      tabindex="-1"
      aria-label={i18n.t("filters.close")}
      onclick={close}
    ></button>
    <div
      role="dialog"
      aria-label={i18n.t("filters.title")}
      tabindex="-1"
      bind:this={panel}
      class="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface-raised p-2 shadow-lg outline-none"
    >
      {@render sectionLabel(i18n.t("filters.kind"), kinds.length, false)}
      {#each KIND_OPTIONS as option (option)}
        <label
          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
        >
          <input
            type="checkbox"
            checked={kinds.includes(option)}
            onchange={() => onToggleKind(option)}
            class="accent-[var(--accent)]"
          />
          <span class="min-w-0 flex-1 truncate">{i18n.t(`kind.${option}`)}</span>
        </label>
      {/each}

      {@render sectionLabel(
        i18n.t("filters.status"),
        (favoritesOnly ? 1 : 0) + (editedOnly ? 1 : 0),
        true,
      )}
      <label
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
      >
        <input
          type="checkbox"
          checked={favoritesOnly}
          onchange={onToggleFavorites}
          class="accent-[var(--accent)]"
        />
        <span class="min-w-0 flex-1 truncate">{i18n.t("fav.toggle")}</span>
      </label>
      <label
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
      >
        <input
          type="checkbox"
          checked={editedOnly}
          onchange={onToggleEdited}
          class="accent-[var(--accent)]"
        />
        <span class="min-w-0 flex-1 truncate">{i18n.t("edit.toggle")}</span>
      </label>

      {@render sectionLabel(i18n.t("filters.authors"), authors.length, true)}
      {#if authorGroups.length === 0}
        <p class="px-2 py-2 text-sm text-fg-muted">
          {i18n.t("filters.noAuthors")}
        </p>
      {:else}
        {@render facetSearch(
          authorQuery,
          i18n.t("filters.searchAuthors"),
          setAuthorQuery,
        )}
        <div class="relative -mx-1">
          <div
            bind:this={authorsList}
            onscroll={measureAuthors}
            class="max-h-40 overflow-y-auto overscroll-contain px-1"
          >
            {#if visibleAuthors.length === 0}
              <p class="px-2 py-2 text-sm text-fg-muted">{i18n.t("filters.noMatch")}</p>
            {:else}
              {#each visibleAuthors as group (group.key)}
                <label
                  class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={authors.includes(group.key)}
                    onchange={() => onToggleAuthor(group.key)}
                    class="accent-[var(--accent)]"
                  />
                  <span class="min-w-0 flex-1 truncate">
                    {group.name ?? unknownAuthor}
                  </span>
                  <span class="shrink-0 text-xs text-fg-subtle">{group.clippingCount}</span>
                </label>
              {/each}
            {/if}
          </div>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface-raised via-surface-raised/80 to-transparent transition-opacity duration-150 {authorsMore
              ? 'opacity-100'
              : 'opacity-0'}"
          ></div>
        </div>
      {/if}

      {@render sectionLabel(i18n.t("filters.tags"), tagIds.length, true)}
      {#if tags.length === 0}
        <p class="px-2 py-2 text-sm text-fg-muted">
          {i18n.t("tags.empty")}
        </p>
      {:else}
        {@render facetSearch(
          tagQuery,
          i18n.t("filters.searchTags"),
          setTagQuery,
        )}
        <div class="relative -mx-1">
          <div
            bind:this={tagsList}
            onscroll={measureTags}
            class="max-h-40 overflow-y-auto overscroll-contain px-1"
          >
            {#if visibleTags.length === 0}
              <p class="px-2 py-2 text-sm text-fg-muted">{i18n.t("filters.noMatch")}</p>
            {:else}
              {#each visibleTags as tag (tag.id)}
                <label
                  class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={tagIds.includes(tag.id)}
                    onchange={() => onToggleTag(tag.id)}
                    class="accent-[var(--accent)]"
                  />
                  <span class="min-w-0 flex-1 truncate">#{tag.name}</span>
                  <span class="shrink-0 text-xs text-fg-subtle">{tag.clipping_count}</span>
                </label>
              {/each}
            {/if}
          </div>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface-raised via-surface-raised/80 to-transparent transition-opacity duration-150 {tagsMore
              ? 'opacity-100'
              : 'opacity-0'}"
          ></div>
        </div>
      {/if}

      {#if activeCount > 0}
        <div class="mt-1 border-t border-line-subtle pt-1">
          <button
            type="button"
            onclick={clear}
            class="w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-fg-muted transition hover:bg-surface-hover"
          >
            {i18n.t("results.clear")}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
