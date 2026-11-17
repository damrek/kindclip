<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext } from "../lib/i18n";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import { formatReminderAt, type ReminderItem } from "../lib/reminders";

  interface Props {
    /** Pending reminders, oldest first. */
    items: ReminderItem[];
    /** Clipping whose write is in flight. */
    busyId: number | null;
    onEdit: (item: ReminderItem) => void;
    onRemove: (clippingId: number) => Promise<boolean>;
    onClose: () => void;
  }

  const { items, busyId, onEdit, onRemove, onClose }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  /** Row waiting for the destructive confirmation. */
  let confirming = $state<number | null>(null);
  let working = $state(false);
  let failed = $state(false);

  async function remove(clippingId: number): Promise<void> {
    working = true;
    failed = false;
    try {
      if (await onRemove(clippingId)) {
        confirming = null;
      } else {
        failed = true;
      }
    } finally {
      working = false;
    }
  }
</script>

<Modal
  label={i18n.t("reminders.title")}
  {onClose}
  busy={busyId !== null || working}
  panel="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface-raised p-5"
>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-sm font-medium text-fg">{i18n.t("reminders.title")}</h2>
      <p class="mt-0.5 text-xs text-fg-muted">{i18n.t("reminders.hint")}</p>
    </div>
    <button
      type="button"
      onclick={onClose}
      disabled={working}
      aria-label={i18n.t("card.cancel")}
      class="rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg disabled:opacity-40"
    >
      ×
    </button>
  </div>

  {#if items.length === 0}
    <p class="py-8 text-center text-sm text-fg-subtle">{i18n.t("reminders.empty")}</p>
  {:else}
    <ul class="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
      {#each items as item (item.clippingId)}
        <li class="rounded-lg border border-line p-2.5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm text-fg" title={item.bookTitle}>{item.bookTitle}</p>
              <p class="text-xs text-fg-muted">{formatReminderAt(item.at, i18n.locale)}</p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onclick={() => onEdit(item)}
                disabled={busyId !== null || working}
                aria-label={i18n.t("reminders.edit")}
                title={i18n.t("reminders.edit")}
                class="grid h-8 w-8 place-items-center rounded-[9px] text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
              >
                <Icon name="edit" class="h-4 w-4" />
              </button>
              <button
                type="button"
                onclick={() => (confirming = item.clippingId)}
                disabled={busyId !== null || working}
                aria-label={i18n.t("reminders.remove")}
                title={i18n.t("reminders.remove")}
                class="grid h-8 w-8 place-items-center rounded-[9px] text-fg-muted transition hover:bg-surface-hover hover:text-danger disabled:opacity-40"
              >
                <Icon name="close" class="h-4 w-4" />
              </button>
            </div>
          </div>

          {#if confirming === item.clippingId}
            <div class="mt-2 border-t border-line-subtle pt-2">
              <p class="text-xs text-danger">
                {i18n.t("reminders.confirm", { title: item.bookTitle })}
              </p>
              <div class="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onclick={() => (confirming = null)}
                  disabled={working}
                  class="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
                >
                  {i18n.t("card.cancel")}
                </button>
                <button
                  type="button"
                  onclick={() => remove(item.clippingId)}
                  disabled={working}
                  class="rounded-full bg-danger-solid px-3 py-1 text-xs font-medium text-inverse-fg transition hover:bg-danger-solid-hover disabled:opacity-40"
                >
                  {i18n.t("reminders.remove")}
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if failed}
      <p class="mt-2 text-xs text-danger" role="alert">{i18n.t("reminder.error")}</p>
    {/if}
  {/if}
</Modal>
