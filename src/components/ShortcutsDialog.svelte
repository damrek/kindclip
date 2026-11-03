<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { commandKeyLabel, isMacPlatform } from "../lib/shortcuts";
  import { focusOnMount, trapFocus } from "../lib/focus";

  interface Props {
    onClose: () => void;
  }

  const { onClose }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const mod = commandKeyLabel(isMacPlatform(navigator.userAgent));

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
        { combos: [[mod, ","]], label: i18n.t("shortcuts.preferences") },
      ],
    },
  ]);
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={i18n.t("shortcuts.close")}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t("shortcuts.title")}
    tabindex={-1}
    use:focusOnMount
    use:trapFocus
    class="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900"
  >
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {i18n.t("shortcuts.title")}
      </h2>
      <button
        type="button"
        onclick={onClose}
        aria-label={i18n.t("shortcuts.close")}
        class="rounded-full px-2 text-lg leading-none text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        ×
      </button>
    </div>

    {#each groups as group (group.title)}
      <section class="mt-4">
        <h3 class="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {group.title}
        </h3>
        <dl class="mt-1.5 divide-y divide-neutral-100 dark:divide-neutral-800">
          {#each group.rows as row (row.label)}
            <div class="flex items-center justify-between gap-4 py-1.5">
              <dt class="text-sm text-neutral-700 dark:text-neutral-300">{row.label}</dt>
              <dd class="flex shrink-0 items-center gap-1">
                {#each row.combos as combo, index (index)}
                  {#if index > 0}
                    <span class="px-0.5 text-xs text-neutral-400">/</span>
                  {/if}
                  <span class="flex items-center gap-1">
                    {#each combo as key (key)}
                      <kbd
                        class="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
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

    <p
      class="mt-4 border-t border-neutral-100 pt-3 text-center text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"
    >
      {i18n.t("shortcuts.hint")}
    </p>
  </div>
</div>
