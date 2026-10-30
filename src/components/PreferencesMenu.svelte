<script lang="ts">
  import { getContext } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import Icon from "./Icon.svelte";
  import {
    I18N_CONTEXT_KEY,
    LOCALES,
    LOCALE_NAMES,
    type I18nContext,
    type Locale,
  } from "../lib/i18n";
  import { THEME_CHOICES, type ThemeChoice } from "../lib/theme";
  import { FONT_SCALES, type FontScale } from "../lib/font";

  interface Props {
    locale: Locale;
    theme: ThemeChoice;
    font: FontScale;
    dbBusy: boolean;
    onLocale: (locale: Locale) => void;
    onTheme: (choice: ThemeChoice) => void;
    onFont: (scale: FontScale) => void;
    onOpenDb: () => void;
  }

  const { locale, theme, font, dbBusy, onLocale, onTheme, onFont, onOpenDb }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  let open = $state(false);
  let version = $state<string | null>(null);

  $effect(() => {
    getVersion()
      .then((value) => {
        version = value;
      })
      .catch(() => {
        // Outside the Tauri runtime (plain browser) the version stays hidden.
      });
  });

  function toggleMenu(): void {
    open = !open;
  }

  function close(): void {
    open = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") close();
  }

  function openDb(): void {
    close();
    onOpenDb();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="relative">
  <button
    type="button"
    onclick={toggleMenu}
    aria-expanded={open}
    aria-haspopup="dialog"
    title={i18n.t("prefs.open")}
    aria-label={i18n.t("prefs.open")}
    class="rounded-full px-2.5 py-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
  >
    <Icon name="more" class="h-4 w-4" />
  </button>

  {#if open}
    <button
      type="button"
      class="fixed inset-0 z-10 cursor-default"
      tabindex="-1"
      aria-label={i18n.t("prefs.close")}
      onclick={close}
    ></button>
    <div
      role="dialog"
      aria-label={i18n.t("prefs.title")}
      class="absolute right-0 z-20 mt-1 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-neutral-200 bg-white p-3 shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-900"
    >
      <p class="pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {i18n.t("prefs.appearance")}
      </p>

      <label class="block pb-1">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">{i18n.t("lang.label")}</span>
        <select
          value={locale}
          onchange={(event) => onLocale(event.currentTarget.value as Locale)}
          aria-label={i18n.t("lang.label")}
          class="mt-0.5 w-full cursor-pointer rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-500"
        >
          {#each LOCALES as code (code)}
            <option value={code}>{LOCALE_NAMES[code]}</option>
          {/each}
        </select>
      </label>

      <div class="pb-1">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">{i18n.t("prefs.theme")}</span>
        <div
          class="mt-0.5 flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700"
          role="group"
          aria-label={i18n.t("prefs.theme")}
        >
          {#each THEME_CHOICES as choice (choice)}
            <button
              type="button"
              onclick={() => onTheme(choice)}
              aria-pressed={theme === choice}
              class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition {theme === choice
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            >
              {i18n.t(`theme.${choice}`)}
            </button>
          {/each}
        </div>
      </div>

      <div>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">{i18n.t("prefs.font")}</span>
        <div
          class="mt-0.5 flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700"
          role="group"
          aria-label={i18n.t("prefs.font")}
        >
          {#each FONT_SCALES as scale (scale)}
            <button
              type="button"
              onclick={() => onFont(scale)}
              aria-pressed={font === scale}
              class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition {font === scale
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            >
              {i18n.t(`font.${scale}`)}
            </button>
          {/each}
        </div>
      </div>

      <div class="mt-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
        <p class="pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {i18n.t("prefs.data")}
        </p>
        <button
          type="button"
          onclick={openDb}
          disabled={dbBusy}
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Icon name="folder" />
          <span class="min-w-0 flex-1 truncate">{i18n.t("db.open")}</span>
        </button>
      </div>

      {#if version}
        <p
          class="mt-2 border-t border-neutral-100 pt-2 text-center text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"
        >
          {i18n.t("prefs.version", { version })}
        </p>
      {/if}
    </div>
  {/if}
</div>
