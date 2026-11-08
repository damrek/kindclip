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
    class="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface-raised p-5"
  >
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-sm font-medium text-fg">
        {i18n.t("shortcuts.title")}
      </h2>
      <button
        type="button"
        onclick={onClose}
        aria-label={i18n.t("shortcuts.close")}
        class="rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg"
      >
        ×
      </button>
    </div>

    {#each groups as group (group.title)}
      <section class="mt-4">
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

    <p
      class="mt-4 border-t border-line-subtle pt-3 text-center text-xs text-fg-subtle"
    >
      {i18n.t("shortcuts.hint")}
    </p>
  </div>
</div>
