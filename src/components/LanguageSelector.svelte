<script lang="ts">
  import { getContext } from "svelte";
  import {
    I18N_CONTEXT_KEY,
    LOCALES,
    LOCALE_NAMES,
    type I18nContext,
    type Locale,
  } from "../lib/i18n";

  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
</script>

<label
  class="flex items-center gap-1 rounded-full px-1 py-1 text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
  title={i18n.t("lang.label")}
>
  <span class="sr-only">{i18n.t("lang.label")}</span>
  <span aria-hidden="true" class="pl-1.5 text-base leading-none">🌐</span>
  <select
    value={i18n.locale}
    onchange={(event) => i18n.setLocale(event.currentTarget.value as Locale)}
    aria-label={i18n.t("lang.label")}
    class="cursor-pointer appearance-none bg-transparent pr-1.5 text-sm outline-none"
  >
    {#each LOCALES as code (code)}
      <option value={code}>{LOCALE_NAMES[code]}</option>
    {/each}
  </select>
</label>
