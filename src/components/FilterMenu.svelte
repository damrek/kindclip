<script lang="ts">
  import { getContext, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import type { TagCount } from "../lib/db";
  import type { ClippingKind } from "../lib/types";

  interface Props {
    /** Controlled by App so Escape closes one layer in order. */
    open?: boolean;
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

  let {
    open = $bindable(false),
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

  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let wasOpen = false;

  // Keyboard-first: the panel takes focus when opened (f) and the trigger
  // gets it back when Escape or a click closes the menu.
  $effect(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    void tick().then(() => {
      if (open) {
        panel?.focus();
      } else {
        trigger?.focus();
      }
    });
  });

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
</script>

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
      class="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-lg outline-none"
    >
      <p class="px-2 pt-1 pb-1 text-xs font-medium text-fg-muted">
        {i18n.t("filters.kind")}
      </p>
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

      <p
        class="mt-1 border-t border-line-subtle px-2 pt-2 pb-1 text-xs font-medium text-fg-muted"
      >
        {i18n.t("filters.status")}
      </p>
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

      <p
        class="mt-1 border-t border-line-subtle px-2 pt-2 pb-1 text-xs font-medium text-fg-muted"
      >
        {i18n.t("filters.tags")}
      </p>
      {#if tags.length === 0}
        <p class="px-2 py-2 text-sm text-fg-muted">
          {i18n.t("tags.empty")}
        </p>
      {:else}
        {#each tags as tag (tag.id)}
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
            <span class="text-xs text-fg-subtle">{tag.clipping_count}</span>
          </label>
        {/each}
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
