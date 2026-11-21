<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { ScrollFade } from "../lib/scrollFade.svelte";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import ScrollFadeOverlay from "./ScrollFadeOverlay.svelte";
  import { commandKeyLabel, isMacPlatform } from "../lib/shortcuts";

  interface Props {
    onClose: () => void;
    /** Opened from Preferences: closing goes back there instead of the shell. */
    fromPreferences?: boolean;
  }

  const { onClose, fromPreferences = false }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const mod = commandKeyLabel(isMacPlatform(navigator.userAgent));

  const fade = new ScrollFade();

  interface Row {
    /** Each entry is one key combo; several entries are alternatives. */
    combos: string[][];
    label: string;
  }

  interface Group {
    title: string;
    rows: Row[];
  }

  const groups = $derived<Group[]>([
    {
      title: i18n.t("shortcuts.group.search"),
      rows: [
        {
          combos: [[mod, "P"]],
          label: i18n.t("shortcuts.commandPalette"),
        },
        {
          combos: [["/"], [mod, "K"], [mod, "F"]],
          label: i18n.t("shortcuts.focusSearch"),
        },
        { combos: [["Esc"]], label: i18n.t("shortcuts.clearSearch") },
      ],
    },
    {
      title: i18n.t("shortcuts.group.dialogs"),
      rows: [
        { combos: [["Esc"]], label: i18n.t("shortcuts.closeDialog") },
        { combos: [["?"]], label: i18n.t("shortcuts.help") },
      ],
    },
    {
      title: i18n.t("shortcuts.group.navigation"),
      rows: [
        { combos: [["j"], ["↓"]], label: i18n.t("shortcuts.nextClipping") },
        { combos: [["k"], ["↑"]], label: i18n.t("shortcuts.prevClipping") },
        { combos: [["Enter"], ["o"]], label: i18n.t("shortcuts.openClipping") },
        { combos: [["n"], ["PgDn"]], label: i18n.t("shortcuts.nextPage") },
        { combos: [["p"], ["PgUp"]], label: i18n.t("shortcuts.prevPage") },
        { combos: [["s"]], label: i18n.t("shortcuts.sidebar") },
        { combos: [["f"]], label: i18n.t("shortcuts.filters") },
      ],
    },
    {
      title: i18n.t("shortcuts.group.actions"),
      rows: [
        { combos: [["*"]], label: i18n.t("shortcuts.favorite") },
        { combos: [["c"]], label: i18n.t("shortcuts.copy") },
        { combos: [["q"]], label: i18n.t("shortcuts.copyQuote") },
        { combos: [[mod, ","]], label: i18n.t("shortcuts.preferences") },
      ],
    },
  ]);
</script>

<Modal
    label={i18n.t("shortcuts.title")}
    onClose={onClose}
    panel="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface-raised p-4"
  >
    <div class="flex items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-1">
        {#if fromPreferences}
          <button
            type="button"
            onclick={onClose}
            aria-label={i18n.t("shortcuts.back")}
            title={i18n.t("shortcuts.back")}
            class="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-surface-hover hover:text-fg"
          >
            <Icon name="back" />
          </button>
        {/if}
        <h2 class="truncate text-sm font-medium text-fg">
          {i18n.t("shortcuts.title")}
        </h2>
      </div>
      {#if !fromPreferences}
        <button
          type="button"
          onclick={onClose}
          aria-label={i18n.t("shortcuts.close")}
          title={i18n.t("shortcuts.close")}
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-fg-subtle transition hover:bg-surface-hover hover:text-fg"
        >
          ×
        </button>
      {/if}
    </div>

    <!-- The list scrolls inside the panel, inset from the border: the panel
         keeps its rounded corners and the scrollbar never crosses them. -->
    <div class="relative -mx-1 mt-4 flex min-h-0 flex-1 flex-col">
      <div
        use:fade.track
        class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-1"
      >
        {#each groups as group (group.title)}
          <section>
            <h3 class="text-xs font-medium text-fg-muted">
              {group.title}
            </h3>
            <dl class="mt-1.5 divide-y divide-line-subtle">
              {#each group.rows as row (row.label)}
                <div class="flex items-center justify-between gap-4 py-1.5">
                  <dt class="text-sm text-fg">{row.label}</dt>
                  <dd class="flex shrink-0 items-center gap-1">
                    {#each row.combos as combo, index (index)}
                      {#if index > 0}
                        <span class="px-0.5 text-xs text-fg-subtle">/</span>
                      {/if}
                      <span class="flex items-center gap-1">
                        {#each combo as key (key)}
                          <kbd
                            class="rounded-md border border-line bg-surface-inset px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg-muted"
                          >
                            {key}
                          </kbd>
                        {/each}
                      </span>
                    {/each}
                  </dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
      <ScrollFadeOverlay
        visible={fade.moreBelow}
        class="inset-x-0 -bottom-px h-8"
      />
    </div>

    <p
      class="mt-3 shrink-0 border-t border-line-subtle pt-3 text-center text-xs text-fg-subtle"
    >
      {i18n.t("shortcuts.hint")}
    </p>
</Modal>
