<script lang="ts">
  import { getContext } from "svelte";
  import { I18N_CONTEXT_KEY, type I18nContext, type I18nKey } from "../lib/i18n";
  import Modal from "./Modal.svelte";
  import {
    combineLocal,
    formatReminderAt,
    inOneWeek,
    toDateInput,
    tomorrowMorning,
    tonight,
  } from "../lib/reminders";
  import type { ScheduleResult } from "../lib/app/reminders.svelte";

  interface Props {
    /** Book title, the context line above the controls. */
    title: string;
    /** Existing reminder, ISO UTC, or null. */
    reminderAt: string | null;
    busy: boolean;
    onSchedule: (at: Date) => Promise<ScheduleResult>;
    onCancelReminder: () => Promise<boolean>;
    onClose: () => void;
  }

  const {
    title,
    reminderAt,
    busy,
    onSchedule,
    onCancelReminder,
    onClose,
  }: Props = $props();
  const i18n = getContext<I18nContext>(I18N_CONTEXT_KEY);

  const initial = tomorrowMorning(new Date());
  /** Separate date, hour and minute controls: WebKit renders `datetime-local`
   * without a time picker, so the dialog never offered a concrete hour. */
  let dateValue = $state(toDateInput(initial));
  let hour = $state(initial.getHours());
  let minute = $state(initial.getMinutes());
  let error = $state<I18nKey | null>(null);
  let working = $state(false);

  const HOURS = Array.from({ length: 24 }, (_, index) => index);
  const MINUTES = Array.from({ length: 60 }, (_, index) => index);
  const two = (value_: number): string => String(value_).padStart(2, "0");

  const presets: Array<{ key: I18nKey; at: () => Date }> = [
    { key: "reminder.tonight", at: () => tonight(new Date()) },
    { key: "reminder.tomorrow", at: () => tomorrowMorning(new Date()) },
    { key: "reminder.nextWeek", at: () => inOneWeek(new Date()) },
  ];

  function applyPreset(at: Date): void {
    dateValue = toDateInput(at);
    hour = at.getHours();
    minute = at.getMinutes();
    error = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const at = combineLocal(dateValue, hour, minute);
    if (at === null || at.getTime() <= Date.now()) {
      error = "reminder.invalid";
      return;
    }
    working = true;
    error = null;
    try {
      const result = await onSchedule(at);
      if (result === "ok") {
        onClose();
        return;
      }
      error =
        result === "denied"
          ? "reminder.denied"
          : result === "past" || result === "invalid"
            ? "reminder.invalid"
            : "reminder.error";
    } finally {
      working = false;
    }
  }

  async function removeReminder(): Promise<void> {
    working = true;
    try {
      if (await onCancelReminder()) {
        onClose();
      } else {
        error = "reminder.error";
      }
    } finally {
      working = false;
    }
  }
</script>

<Modal
  label={i18n.t("reminder.title")}
  {onClose}
  busy={busy || working}
  panel="flex w-full max-w-md flex-col rounded-2xl border border-line bg-surface-raised p-5"
>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-sm font-medium text-fg">{i18n.t("reminder.title")}</h2>
      <p class="mt-0.5 truncate text-xs text-fg-muted" title={title}>{title}</p>
    </div>
    <button
      type="button"
      onclick={onClose}
      disabled={busy || working}
      aria-label={i18n.t("card.cancel")}
      class="rounded-full px-2 text-lg leading-none text-fg-subtle transition hover:text-fg disabled:opacity-40"
    >
      ×
    </button>
  </div>

  {#if reminderAt}
    <div
      class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft p-3"
    >
      <p class="text-xs text-accent-text">
        {i18n.t("reminder.current", {
          date: formatReminderAt(reminderAt, i18n.locale),
        })}
      </p>
      <button
        type="button"
        onclick={removeReminder}
        disabled={busy || working}
        class="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
      >
        {i18n.t("reminder.cancel")}
      </button>
    </div>
  {/if}

  <div class="mt-3 flex flex-wrap gap-1.5">
    {#each presets as preset (preset.key)}
      <button
        type="button"
        onclick={() => applyPreset(preset.at())}
        disabled={busy || working}
        class="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
      >
        {i18n.t(preset.key)}
      </button>
    {/each}
  </div>

  <form class="mt-3" onsubmit={submit}>
    <span class="text-xs text-fg-muted">{i18n.t("reminder.custom")}</span>
    <div class="mt-1 flex items-center gap-2">
      <input
        type="date"
        bind:value={dateValue}
        min={toDateInput(new Date())}
        aria-label={i18n.t("reminder.date")}
        disabled={busy || working}
        class="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-line-strong disabled:opacity-60"
      />
      <select
        bind:value={hour}
        aria-label={i18n.t("reminder.hour")}
        disabled={busy || working}
        class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong disabled:opacity-60"
      >
        {#each HOURS as option (option)}
          <option value={option}>{two(option)}</option>
        {/each}
      </select>
      <span class="text-sm text-fg-muted" aria-hidden="true">:</span>
      <select
        bind:value={minute}
        aria-label={i18n.t("reminder.minute")}
        disabled={busy || working}
        class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-line-strong disabled:opacity-60"
      >
        {#each MINUTES as option (option)}
          <option value={option}>{two(option)}</option>
        {/each}
      </select>
    </div>

    <p class="mt-2 text-xs text-fg-subtle">{i18n.t("reminder.hint")}</p>
    {#if error}
      <p class="mt-2 text-xs text-danger" role="alert">{i18n.t(error)}</p>
    {/if}

    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onclick={onClose}
        disabled={busy || working}
        class="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover disabled:opacity-40"
      >
        {i18n.t("card.cancel")}
      </button>
      <button
        type="submit"
        disabled={busy || working}
        class="rounded-full bg-inverse px-3.5 py-1.5 text-xs font-medium text-inverse-fg transition hover:opacity-80 disabled:opacity-40"
      >
        {i18n.t("reminder.save")}
      </button>
    </div>
  </form>
</Modal>
