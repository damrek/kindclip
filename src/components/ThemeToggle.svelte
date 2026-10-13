<script lang="ts">
  import { getContext } from "svelte";
  import { applyThemeClass, resolveTheme, type ThemeChoice } from "../lib/theme";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";

  interface Props {
    choice: ThemeChoice;
    onCycle: () => void;
  }

  const { choice, onCycle }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  $effect(() => {
    const current = choice;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void =>
      applyThemeClass(document.documentElement, resolveTheme(current, query.matches));
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  });

  const icon = $derived(choice === "light" ? "☀" : choice === "dark" ? "☾" : "◐");
  const label = $derived(
    choice === "light"
      ? i18n.t("theme.light")
      : choice === "dark"
        ? i18n.t("theme.dark")
        : i18n.t("theme.system"),
  );
</script>

<button
  type="button"
  onclick={onCycle}
  title={label}
  aria-label={label}
  class="rounded-full px-2.5 py-1.5 text-base leading-none text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
>
  {icon}
</button>
