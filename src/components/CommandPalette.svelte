<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { debounce, formatReference } from "../lib/library";
  import { searchClippings } from "../lib/db";
  import { stepSelection } from "../lib/shortcuts";
  import { focusOnMount, selectOnInteraction, trapFocus } from "../lib/focus";
  import type { ClippingRow } from "../lib/types";
  import HighlightedText from "./HighlightedText.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    onClose: () => void;
    /** Rows currently shown, the chosen id, and the query that found them. */
    onOpen: (items: ClippingRow[], id: number, query: string) => void;
  }

  const { onClose, onOpen }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  /** Typing shows this many matches; the empty query shows fewer recents. */
  const RESULT_LIMIT = 50;
  const RECENT_LIMIT = 20;

  let query = $state("");
  let results = $state<ClippingRow[]>([]);
  let selectedId = $state<number | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let more = $state(false);
  /** Query that produced `results`; Enter waits for a newer one. */
  let resultsQuery = $state("");
  let pendingOpen = false;
  let destroyed = false;
  let request = 0;

  const searching = $derived(query.trim() !== "");

  const schedule = debounce((value: string) => void load(value), 180);

  async function load(value: string): Promise<void> {
    const current = ++request;
    const limit = value.trim() === "" ? RECENT_LIMIT : RESULT_LIMIT;
    loading = true;
    error = null;
    try {
      const rows = await searchClippings(value, limit + 1);
      if (current !== request || destroyed) return;
      more = value.trim() !== "" && rows.length > limit;
      results = rows.slice(0, limit);
      resultsQuery = value;
      selectedId = results[0]?.id ?? null;
      if (pendingOpen) {
        pendingOpen = false;
        const first = results[0]?.id ?? null;
        if (first !== null) {
          onOpen(results, first, value);
        }
      }
    } catch (cause) {
      if (current !== request || destroyed) return;
      results = [];
      resultsQuery = value;
      selectedId = null;
      more = false;
      pendingOpen = false;
      error = i18n.t("palette.error", {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      if (current === request) {
        loading = false;
      }
    }
  }

  onMount(() => {
    void load("");
    return () => {
      destroyed = true;
      schedule.cancel();
    };
  });

  // Keep the keyboard selection visible while the list scrolls.
  $effect(() => {
    if (selectedId === null) return;
    document
      .getElementById(`palette-option-${selectedId}`)
      ?.scrollIntoView({ block: "nearest" });
  });

  function onInput(value: string): void {
    query = value;
    pendingOpen = false;
    schedule(value);
  }

  function submit(): void {
    if (resultsQuery === query && selectedId !== null) {
      onOpen(results, selectedId, query);
      return;
    }
    if (resultsQuery !== query) {
      pendingOpen = true;
      schedule.cancel();
      void load(query);
    }
  }

  function open(id: number): void {
    if (resultsQuery !== query) return;
    onOpen(results, id, query);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedId = stepSelection(results, selectedId, "next");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedId = stepSelection(results, selectedId, "prev");
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
  <button
    type="button"
    aria-label={i18n.t("palette.close")}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("palette.placeholder")}
    use:trapFocus
    class="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-2xl"
  >
    <div class="flex items-center gap-2 border-b border-line px-4 transition-colors focus-within:border-accent">
      <span class="text-fg-subtle" aria-hidden="true">
        <Icon name="search" class="h-4 w-4" />
      </span>
      <input
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-listbox"
        aria-autocomplete="list"
        aria-activedescendant={selectedId === null ? undefined : `palette-option-${selectedId}`}
        aria-label={i18n.t("palette.placeholder")}
        placeholder={i18n.t("palette.placeholder")}
        autocomplete="off"
        spellcheck="false"
        value={query}
        oninput={(event) => onInput(event.currentTarget.value)}
        onkeydown={onKeydown}
        use:focusOnMount
        class="palette-field min-w-0 flex-1 bg-transparent py-3.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      <button
        type="button"
        onclick={onClose}
        aria-label={i18n.t("palette.close")}
        class="rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg"
      >
        ×
      </button>
    </div>

    {#if error}
      <p class="px-4 py-8 text-sm text-danger" role="alert">{error}</p>
    {:else if loading && results.length === 0}
      <p class="px-4 py-8 text-sm text-fg-subtle">{i18n.t("palette.loading")}</p>
    {:else if results.length === 0}
      <p class="px-4 py-8 text-sm text-fg-subtle">
        {#if searching}
          {i18n.t("palette.noResults", { query: query.trim() })}
        {:else}
          {i18n.t("palette.empty")}
        {/if}
      </p>
    {:else}
      {#if !searching}
        <p class="px-4 pt-3 text-xs font-medium text-fg-subtle">
          {i18n.t("palette.recent")}
        </p>
      {/if}
      <ul
        id="palette-listbox"
        role="listbox"
        aria-label={i18n.t("palette.placeholder")}
        aria-busy={loading}
        class="max-h-[58vh] space-y-0.5 overflow-y-auto p-2"
      >
        {#each results as item (item.id)}
          {@const reference = formatReference(item.page, item.location)}
          <li
            id={`palette-option-${item.id}`}
            role="option"
            aria-selected={item.id === selectedId}
            use:selectOnInteraction={() => open(item.id)}
            class="cursor-pointer rounded-lg border px-3 py-2.5 transition {item.id ===
            selectedId
              ? 'border-line-strong bg-surface-hover'
              : 'border-transparent'}"
          >
            <div class="flex items-start gap-3">
              <p class="min-w-0 flex-1 text-sm text-fg">
                {#if item.content !== null || item.content_edited !== null}
                  <HighlightedText
                    text={item.content_edited ?? item.content ?? ""}
                    {query}
                  />
                {:else}
                  <span class="italic text-fg-subtle">
                    {i18n.t(`kind.${item.kind}`)}
                  </span>
                {/if}
              </p>
              <span
                class="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-fg-muted"
              >
                {i18n.t(`kind.${item.kind}`)}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
              <span class="min-w-0 truncate">
                <HighlightedText text={item.title} {query} />
              </span>
              {#if item.author}
                <span class="min-w-0 truncate">
                  · <HighlightedText text={item.author} {query} />
                </span>
              {/if}
              {#if reference !== ""}
                <span class="shrink-0">· {reference}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <div
      class="flex items-center justify-between gap-4 border-t border-line px-4 py-2 text-xs text-fg-subtle"
    >
      <span class="min-w-0 truncate">{i18n.t("palette.hint")}</span>
      {#if more}
        <span class="shrink-0">
          {i18n.t("palette.more", { count: RESULT_LIMIT })}
        </span>
      {/if}
    </div>
  </div>
</div>
