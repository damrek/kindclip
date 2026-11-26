<script lang="ts">
  import { getContext } from "svelte";
  import type { UpdateStatus } from "../lib/app/updates.svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import { ScrollFade } from "../lib/scrollFade.svelte";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import ReleaseNotes from "./ReleaseNotes.svelte";
  import ScrollFadeOverlay from "./ScrollFadeOverlay.svelte";

  interface Props {
    status: UpdateStatus;
    version: string | null;
    notes: string;
    error: string | null;
    appVersion: string | null;
    busy: boolean;
    available: boolean;
    onClose: () => void;
    onInstall: () => void;
  }

  const {
    status,
    version,
    notes,
    error,
    appVersion,
    busy,
    available,
    onClose,
    onInstall,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);
  const fade = new ScrollFade();

  const headline = $derived.by(() => {
    switch (status) {
      case "available":
        return i18n.t("updates.available", { version: version ?? "" });
      case "current":
        return i18n.t("updates.current");
      case "checking":
        return i18n.t("updates.checking");
      case "installing":
        return i18n.t("updates.installing");
      case "error":
        return error ?? i18n.t("updates.title");
      default:
        return i18n.t("updates.title");
    }
  });

  const icon = $derived(
    status === "current"
      ? "check"
      : status === "error"
        ? "close"
        : status === "checking"
          ? "search"
          : "download",
  );

  const tone = $derived(
    status === "current"
      ? "bg-success/10 text-success"
      : status === "error"
        ? "bg-danger-soft text-danger"
        : status === "available" || status === "installing"
          ? "bg-accent-soft text-accent-text"
          : "bg-surface-hover text-fg-muted",
  );

  const chipVersion = $derived(
    status === "current"
      ? appVersion
      : status === "installing"
        ? version
        : null,
  );
</script>

<Modal
  label={i18n.t("updates.title")}
  {onClose}
  {busy}
  panel="update-panel flex max-h-[85vh] min-h-[13rem] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-2xl"
>
  <header class="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-4">
    <div class="flex min-w-0 items-start gap-3">
      <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg {tone}">
        <Icon name={icon} class="h-4 w-4" />
      </span>
      <div class="min-w-0">
        <h2 class="text-sm font-medium text-fg">{i18n.t("updates.title")}</h2>
        <p class="mt-0.5 text-sm text-fg-muted">{headline}</p>
      </div>
    </div>
    {#if chipVersion}
      <span
        class="shrink-0 rounded-full border border-line bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-fg-muted tabular-nums"
      >
        {i18n.t("prefs.versionShort", { version: chipVersion })}
      </span>
    {/if}
  </header>

  {#if notes}
    <div class="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-4">
      <h3 class="text-sm font-medium text-fg">
        {i18n.t("updates.whatsNew")}
      </h3>
      <div class="relative mt-3 flex min-h-0 flex-1 flex-col">
        <div
          use:fade.track
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3 [scrollbar-color:var(--line-strong)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-line-strong [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5"
        >
          <ReleaseNotes {notes} />
        </div>
        <ScrollFadeOverlay
          visible={fade.moreBelow}
          class="inset-x-0 bottom-0 h-10"
        />
      </div>
    </div>
  {/if}

  <footer class="mt-auto flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
    <button
      type="button"
      onclick={onClose}
      disabled={busy}
      class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
    >
      {available ? i18n.t("updates.later") : i18n.t("updates.close")}
    </button>
    {#if available}
      <button
        type="button"
        onclick={onInstall}
        disabled={busy}
        class="rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:bg-accent-hover disabled:opacity-40"
      >
        {i18n.t("updates.install")}
      </button>
    {/if}
  </footer>
</Modal>
