<script lang="ts">
  import { getContext } from "svelte";
  import Icon from "./Icon.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { TagCount } from "../lib/db";
  import type { ClippingKind } from "../lib/types";

  interface Props {
    kinds: ClippingKind[];
    favoritesOnly: boolean;
    editedOnly: boolean;
    tagIds: number[];
    tags: TagCount[];
    onToggleKind: (kind: ClippingKind) => void;
    onToggleFavorites: () => void;
    onToggleEdited: () => void;
    onToggleTag: (id: number) => void;
    onClear: () => void;
  }

  const {
    kinds,
    favoritesOnly,
    editedOnly,
    tagIds,
    tags,
    onToggleKind,
    onToggleFavorites,
    onToggleEdited,
    onToggleTag,
    onClear,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  const KIND_OPTIONS: ClippingKind[] = ["highlight", "note", "bookmark"];

  let open = $state(false);

  const activeCount = $derived(
    kinds.length + (favoritesOnly ? 1 : 0) + (editedOnly ? 1 : 0) + tagIds.length,
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

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="relative">
  <button
    type="button"
    onclick={toggleMenu}
    aria-expanded={open}
    aria-haspopup="dialog"
    title={i18n.t("filters.button")}
    class="flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition {activeCount >
    0
      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
  >
    <Icon name="filter" />
    <span>{i18n.t("filters.button")}</span>
    {#if activeCount > 0}
      <span class="rounded-full bg-white/20 px-1.5 text-xs leading-4 dark:bg-neutral-900/10">
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
      class="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-900"
    >
      <p class="px-2 pt-1 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {i18n.t("filters.kind")}
      </p>
      {#each KIND_OPTIONS as option (option)}
        <label
          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <input
            type="checkbox"
            checked={kinds.includes(option)}
            onchange={() => onToggleKind(option)}
            class="accent-amber-500"
          />
          <span class="min-w-0 flex-1 truncate">{i18n.t(`kind.${option}`)}</span>
        </label>
      {/each}

      <p
        class="mt-1 border-t border-neutral-100 px-2 pt-2 pb-1 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
      >
        {i18n.t("filters.status")}
      </p>
      <label
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <input
          type="checkbox"
          checked={favoritesOnly}
          onchange={onToggleFavorites}
          class="accent-amber-500"
        />
        <span class="min-w-0 flex-1 truncate">{i18n.t("fav.toggle")}</span>
      </label>
      <label
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <input
          type="checkbox"
          checked={editedOnly}
          onchange={onToggleEdited}
          class="accent-amber-500"
        />
        <span class="min-w-0 flex-1 truncate">{i18n.t("edit.toggle")}</span>
      </label>

      <p
        class="mt-1 border-t border-neutral-100 px-2 pt-2 pb-1 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
      >
        {i18n.t("filters.tags")}
      </p>
      {#if tags.length === 0}
        <p class="px-2 py-2 text-sm text-neutral-500 dark:text-neutral-400">
          {i18n.t("tags.empty")}
        </p>
      {:else}
        {#each tags as tag (tag.id)}
          <label
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <input
              type="checkbox"
              checked={tagIds.includes(tag.id)}
              onchange={() => onToggleTag(tag.id)}
              class="accent-amber-500"
            />
            <span class="min-w-0 flex-1 truncate">#{tag.name}</span>
            <span class="text-xs text-neutral-400 dark:text-neutral-500">{tag.clipping_count}</span>
          </label>
        {/each}
      {/if}

      {#if activeCount > 0}
        <div class="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
          <button
            type="button"
            onclick={clear}
            class="w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {i18n.t("results.clear")}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
