/** Keyboard-first (roadmap): pure key resolution, target classification and
 * selection stepping. No DOM access, so every rule is testable under node. */

export type ShortcutAction =
  | "focus-search"
  | "open-palette"
  | "open-help"
  | "toggle-sidebar"
  | "open-filters"
  | "open-preferences"
  | "next-clipping"
  | "prev-clipping"
  | "open-clipping"
  | "toggle-favorite"
  | "copy-clipping"
  | "next-page"
  | "prev-page";

export type SelectionDirection = "next" | "prev";

/** The parts of a KeyboardEvent the resolver needs. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
}

/** What the app currently allows; App supplies it from reactive state. */
export interface ShortcutContext {
  /** Focus is in a text field, select or contenteditable. */
  typing: boolean;
  /** Focus is on a control that owns Enter/Space (button, link…). */
  interactive: boolean;
  /** The reading view or a modal dialog is open. */
  overlay: boolean;
  hasLibrary: boolean;
  hasResults: boolean;
  hasSelection: boolean;
  canPrevPage: boolean;
  canNextPage: boolean;
}

/** The parts of an EventTarget the guards need. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);

/** True when the target would swallow a bare letter as text. */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** True when the target already activates on Enter/Space by itself. */
export function isInteractiveTarget(target: TargetLike | null | undefined): boolean {
  if (!target) {
    return false;
  }
  const tag = target.tagName?.toUpperCase();
  if (tag !== undefined && INTERACTIVE_TAGS.has(tag)) {
    return true;
  }
  return target.getAttribute?.("role") === "button";
}

/**
 * Ctrl/Cmd+P, the global palette combo. Shift is irrelevant, Alt is not: the
 * combo belongs to the app in every focus state, so the platform print action
 * must never fire on it.
 */
export function isPaletteCombo(event: KeyEventLike): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }
  if (event.altKey) {
    return false;
  }
  return event.key.length === 1 && event.key.toLowerCase() === "p";
}

/**
 * Map one key event to an app action, or null when the key belongs to the
 * focused control, the open overlay or the browser. Escape is deliberately
 * absent: App closes one overlay layer per press, in its own order.
 */
export function resolveShortcut(
  event: KeyEventLike,
  context: ShortcutContext,
): ShortcutAction | null {
  if (event.defaultPrevented || event.altKey) {
    return null;
  }

  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // Command combos work even while typing, but never through an overlay.
  if (event.metaKey || event.ctrlKey) {
    if (context.overlay) {
      return null;
    }
    if (pressed === "k" || pressed === "f") {
      return "focus-search";
    }
    if (isPaletteCombo(event)) {
      return "open-palette";
    }
    if (pressed === ",") {
      return "open-preferences";
    }
    return null;
  }

  if (context.overlay || context.typing) {
    return null;
  }

  switch (pressed) {
    case "/":
      return "focus-search";
    case "?":
      return "open-help";
    case "s":
      return context.hasLibrary ? "toggle-sidebar" : null;
    case "f":
      return context.hasLibrary ? "open-filters" : null;
    case "j":
    case "ArrowDown":
      return context.hasResults ? "next-clipping" : null;
    case "k":
    case "ArrowUp":
      return context.hasResults ? "prev-clipping" : null;
    case "Enter":
      // A focused button must keep its native activation.
      return !context.interactive && context.hasSelection ? "open-clipping" : null;
    case "o":
      return context.hasSelection ? "open-clipping" : null;
    case "*":
      return context.hasSelection ? "toggle-favorite" : null;
    case "c":
      return context.hasSelection ? "copy-clipping" : null;
    case "n":
    case "PageDown":
      return context.canNextPage ? "next-page" : null;
    case "p":
    case "PageUp":
      return context.canPrevPage ? "prev-page" : null;
    default:
      return null;
  }
}

/**
 * Next selected id inside the visible rows. No selection starts at the first
 * row going forward and the last going back; the boundaries stay put.
 */
export function stepSelection<T extends { id: number }>(
  items: readonly T[],
  currentId: number | null,
  direction: SelectionDirection,
): number | null {
  if (items.length === 0) {
    return null;
  }
  const index =
    currentId === null ? -1 : items.findIndex((item) => item.id === currentId);
  if (index === -1) {
    return direction === "next" ? items[0].id : items[items.length - 1].id;
  }
  const next = index + (direction === "next" ? 1 : -1);
  if (next < 0 || next >= items.length) {
    return items[index].id;
  }
  return items[next].id;
}

/** macOS shows ⌘; every other platform shows Ctrl. */
export function isMacPlatform(userAgent: string): boolean {
  return /Macintosh|Mac OS X/i.test(userAgent);
}

export function commandKeyLabel(isMac: boolean): string {
  return isMac ? "⌘" : "Ctrl";
}
