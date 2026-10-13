<script lang="ts">
  import {
    applyThemeClass,
    loadThemeChoice,
    nextTheme,
    resolveTheme,
    saveThemeChoice,
    type ThemeChoice,
  } from "../lib/theme";

  let choice = $state<ThemeChoice>(loadThemeChoice());

  $effect(() => {
    const current = choice;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void =>
      applyThemeClass(document.documentElement, resolveTheme(current, query.matches));
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  });

  function cycle(): void {
    choice = nextTheme(choice);
    saveThemeChoice(choice);
  }

  const icon = $derived(choice === "light" ? "☀" : choice === "dark" ? "☾" : "◐");
  const label = $derived(
    choice === "light" ? "Tema claro (cambiar)" : choice === "dark" ? "Tema oscuro (cambiar)" : "Tema del sistema (cambiar)",
  );
</script>

<button
  type="button"
  onclick={cycle}
  title={label}
  aria-label={label}
  class="rounded-full px-2.5 py-1.5 text-base leading-none text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
>
  {icon}
</button>
