<script lang="ts">
  import { getContext } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { invoke } from "@tauri-apps/api/core";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import { describeError, logger } from "../lib/log";
  import {
    I18N_CONTEXT_KEY,
    LOCALES,
    LOCALE_NAMES,
    type I18nContext,
    type Locale,
  } from "../lib/i18n";
  import {
    DARK_PALETTES,
    DARK_PALETTE_NAMES,
    THEME_MODES,
    type DarkPalette,
    type ThemeMode,
  } from "../lib/theme";
  import { FONT_SCALES, type FontScale } from "../lib/font";

  interface Props {
    locale: Locale;
    theme: ThemeMode;
    palette: DarkPalette;
    font: FontScale;
    dbBusy: boolean;
    backingUp: boolean;
    backupStatus: string | null;
    autoBackup: boolean;
    onLocale: (locale: Locale) => void;
    onTheme: (choice: ThemeMode) => void;
    onPalette: (palette: DarkPalette) => void;
    onFont: (scale: FontScale) => void;
    onAutoBackup: (enabled: boolean) => void;
    onOpenDb: () => void;
    onBackup: () => void;
    onRestore: () => void;
    onShortcuts: () => void;
    onClose: () => void;
  }

  const {
    locale,
    theme,
    palette,
    font,
    dbBusy,
    backingUp,
    backupStatus,
    autoBackup,
    onLocale,
    onTheme,
    onPalette,
    onFont,
    onAutoBackup,
    onOpenDb,
    onBackup,
    onRestore,
    onShortcuts,
    onClose,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  let version = $state<string | null>(null);
  let logsError = $state<string | null>(null);

  $effect(() => {
    getVersion()
      .then((value) => {
        version = value;
      })
      .catch(() => {
        // Outside the Tauri runtime (plain browser) the version stays hidden.
      });
  });

  /** Diagnostics: the dialog stays open so a failure can be reported in place. */
  async function openLogs(): Promise<void> {
    logsError = null;
    try {
      await invoke("open_logs_dir");
      logger.info("logs: opened the logs folder");
    } catch (error) {
      logger.error("logs-open", error);
      logsError = i18n.t("logs.error", { message: describeError(error) });
    }
  }
</script>

<Modal
    label={i18n.t("prefs.title")}
    onClose={onClose}
    panel="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface-raised p-5"
  >
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-sm font-medium text-fg">
        {i18n.t("prefs.title")}
      </h2>
      <button
        type="button"
        onclick={onClose}
        aria-label={i18n.t("prefs.close")}
        class="-mt-1 rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg"
      >
        ×
      </button>
    </div>

    <!-- The negative margin cancels the horizontal padding, so sections stay
         aligned with the title while a focus ring drawn outside a control has
         room to breathe instead of being clipped by the scroll container. -->
    <div class="-mx-1 mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
      <section aria-labelledby="prefs-appearance">
        <h3
          id="prefs-appearance"
          class="text-xs font-medium tracking-wide text-fg-muted uppercase"
        >
          {i18n.t("prefs.appearance")}
        </h3>

        <label class="mt-2 block">
          <span class="text-xs text-fg-muted">{i18n.t("lang.label")}</span>
          <select
            value={locale}
            onchange={(event) => onLocale(event.currentTarget.value as Locale)}
            aria-label={i18n.t("lang.label")}
            class="mt-0.5 w-full cursor-pointer rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong"
          >
            {#each LOCALES as code (code)}
              <option value={code}>{LOCALE_NAMES[code]}</option>
            {/each}
          </select>
        </label>

        <div class="mt-3">
          <span class="text-xs text-fg-muted">{i18n.t("prefs.theme")}</span>
          <div
            class="mt-0.5 flex rounded-lg border border-line p-0.5"
            role="group"
            aria-label={i18n.t("prefs.theme")}
          >
            {#each THEME_MODES as choice (choice)}
              <button
                type="button"
                onclick={() => onTheme(choice)}
                aria-pressed={theme === choice}
                class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition {theme === choice
                  ? 'bg-inverse text-inverse-fg'
                  : 'text-fg-muted hover:bg-surface-hover'}"
              >
                {i18n.t(`theme.${choice}`)}
              </button>
            {/each}
          </div>
        </div>

        <div class="mt-3">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs text-fg-muted">{i18n.t("prefs.darkPalette")}</span>
            <span class="text-[10px] text-fg-muted">{i18n.t("prefs.paletteHint")}</span>
          </div>
          <div
            class="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4"
            role="group"
            aria-label={i18n.t("prefs.darkPalette")}
          >
            {#each DARK_PALETTES as option (option)}
              <button
                type="button"
                onclick={() => onPalette(option)}
                aria-pressed={palette === option}
                class="rounded-lg border p-1.5 text-left transition {palette === option
                  ? 'border-accent ring-2 ring-accent/40'
                  : 'border-line hover:border-line-strong'}"
              >
                <!-- A nested `data-palette` re-scopes the tokens, so the card
                     previews the real theme instead of a copy of its colors. -->
                <div data-palette={option} aria-hidden="true" class="rounded-md bg-surface p-1">
                  <div class="flex items-center gap-1 rounded bg-surface-raised px-1.5 py-1">
                    <span class="h-2 w-2 shrink-0 rounded-full bg-accent"></span>
                    <span class="text-[10px] font-medium leading-none text-fg">Aa</span>
                    <span class="text-[10px] leading-none text-fg-muted">Aa</span>
                    <span class="ml-auto flex items-center gap-1">
                      <span class="h-1 w-1 rounded-full bg-danger"></span>
                      <span class="h-1 w-1 rounded-full bg-success"></span>
                    </span>
                  </div>
                </div>
                <span
                  class="mt-1 block truncate text-[11px] {palette === option
                    ? 'font-medium text-fg'
                    : 'text-fg-muted'}"
                >
                  {DARK_PALETTE_NAMES[option]}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div class="mt-3">
          <span class="text-xs text-fg-muted">{i18n.t("prefs.font")}</span>
          <div
            class="mt-0.5 flex rounded-lg border border-line p-0.5"
            role="group"
            aria-label={i18n.t("prefs.font")}
          >
            {#each FONT_SCALES as scale (scale)}
              <button
                type="button"
                onclick={() => onFont(scale)}
                aria-pressed={font === scale}
                class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition {font === scale
                  ? 'bg-inverse text-inverse-fg'
                  : 'text-fg-muted hover:bg-surface-hover'}"
              >
                {i18n.t(`font.${scale}`)}
              </button>
            {/each}
          </div>
        </div>
      </section>

      <section class="border-t border-line-subtle pt-4" aria-labelledby="prefs-data">
        <h3 id="prefs-data" class="text-xs font-medium tracking-wide text-fg-muted uppercase">
          {i18n.t("prefs.data")}
        </h3>
        <div class="mt-1 space-y-0.5">
          <label
            class="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted"
          >
            <input
              type="checkbox"
              checked={autoBackup}
              onchange={(event) => onAutoBackup(event.currentTarget.checked)}
              class="mt-0.5 size-3.5 shrink-0"
            />
            <span class="min-w-0 flex-1">{i18n.t("prefs.autoBackup")}</span>
          </label>
          <button
            type="button"
            onclick={onBackup}
            disabled={backingUp || dbBusy}
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
          >
            <Icon name="backup" />
            <span class="min-w-0 flex-1 truncate">{i18n.t("prefs.backup")}</span>
          </button>
          <button
            type="button"
            onclick={onRestore}
            disabled={backingUp || dbBusy}
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
          >
            <Icon name="restore" />
            <span class="min-w-0 flex-1 truncate">{i18n.t("prefs.restore")}</span>
          </button>
          <button
            type="button"
            onclick={onOpenDb}
            disabled={dbBusy}
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
          >
            <Icon name="folder" />
            <span class="min-w-0 flex-1 truncate">{i18n.t("db.open")}</span>
          </button>
          {#if backupStatus}
            <p class="px-2 pt-1 text-xs text-fg-muted" role="status">
              {backupStatus}
            </p>
          {/if}
        </div>
      </section>

      <section class="border-t border-line-subtle pt-4" aria-labelledby="prefs-diagnostics">
        <h3
          id="prefs-diagnostics"
          class="text-xs font-medium tracking-wide text-fg-muted uppercase"
        >
          {i18n.t("prefs.diagnostics")}
        </h3>
        <button
          type="button"
          onclick={openLogs}
          class="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-hover"
        >
          <Icon name="folder" />
          <span class="min-w-0 flex-1 truncate">{i18n.t("logs.open")}</span>
        </button>
        <p class="px-2 pt-1 text-xs text-fg-subtle">
          {i18n.t("logs.privacy")}
        </p>
        {#if logsError}
          <p class="px-2 pt-1 text-xs text-danger" role="alert">{logsError}</p>
        {/if}
      </section>

      <section class="border-t border-line-subtle pt-4" aria-labelledby="prefs-about">
        <h3 id="prefs-about" class="text-xs font-medium tracking-wide text-fg-muted uppercase">
          {i18n.t("prefs.about")}
        </h3>
        <button
          type="button"
          onclick={onShortcuts}
          class="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-hover"
        >
          <Icon name="keyboard" />
          <span class="min-w-0 flex-1 truncate">{i18n.t("shortcuts.open")}</span>
          <kbd class="rounded border border-line px-1 text-[10px] font-medium text-fg-subtle">
            ?
          </kbd>
        </button>
        {#if version}
          <p class="px-2 pt-2 text-xs text-fg-subtle">
            {i18n.t("prefs.version", { version })}
          </p>
        {/if}
      </section>
    </div>
</Modal>
