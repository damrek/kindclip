/** DOM helpers for keyboard-first dialogs. The testable rules live in
 * `shortcuts.ts`; this module only touches the browser. */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Svelte action: take focus as soon as the dialog panel mounts. */
export function focusOnMount(node: HTMLElement): { destroy: () => void } {
  node.focus();
  return { destroy: () => {} };
}

/** Svelte action: report pointer or focus interaction with a composite card.
 * Imperative listeners keep the a11y linter off a non-interactive container. */
export function selectOnInteraction(
  node: HTMLElement,
  onSelect: () => void,
): { update: (next: () => void) => void; destroy: () => void } {
  let select = onSelect;
  const handle = (): void => select();
  node.addEventListener("focusin", handle);
  node.addEventListener("pointerdown", handle);
  return {
    update(next) {
      select = next;
    },
    destroy() {
      node.removeEventListener("focusin", handle);
      node.removeEventListener("pointerdown", handle);
    },
  };
}

/** Svelte action: keep Tab and Shift+Tab inside the dialog panel. */
export function trapFocus(node: HTMLElement): { destroy: () => void } {
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.getClientRects().length > 0,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  node.addEventListener("keydown", onKeydown);
  return { destroy: () => node.removeEventListener("keydown", onKeydown) };
}
