<script lang="ts">
  import type { Snippet } from "svelte";
  import { focusOnMount, trapFocus } from "../lib/focus";

  interface Props {
    /** Accessible name for the dialog; the visible title stays in the content. */
    label: string;
    /** Backdrop click; the shell decides whether Escape reaches this dialog. */
    onClose: () => void;
    /** Disables the backdrop while a write is in flight. */
    busy?: boolean;
    /** Panel layout classes; the primitive keeps the overlay and focus rules. */
    panel?: string;
    children: Snippet;
  }

  const { label, onClose, busy = false, panel = "", children }: Props = $props();
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button
    type="button"
    aria-label={label}
    disabled={busy}
    onclick={onClose}
    class="absolute inset-0 cursor-default bg-black/50"
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    use:focusOnMount
    use:trapFocus
    class="relative {panel}"
  >
    {@render children()}
  </div>
</div>
