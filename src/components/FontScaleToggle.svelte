<script lang="ts">
  import { getContext } from "svelte";
  import { applyFontScale, type FontScale } from "../lib/font";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";

  interface Props {
    scale: FontScale;
    onCycle: () => void;
  }

  const { scale, onCycle }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  $effect(() => {
    applyFontScale(document.documentElement, scale);
  });

  const sizeClass = $derived(
    scale === "small" ? "text-xs" : scale === "large" ? "text-lg" : "text-base",
  );
  const label = $derived(
    scale === "small"
      ? i18n.t("font.small")
      : scale === "large"
        ? i18n.t("font.large")
        : i18n.t("font.medium"),
  );
</script>

<button
  type="button"
  onclick={onCycle}
  title={label}
  aria-label={label}
  class="rounded-full px-2.5 py-1.5 leading-none font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 {sizeClass} dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
>
  A
</button>
