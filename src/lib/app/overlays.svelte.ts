import { tick } from "svelte";

/** Which layer one Escape press closes, innermost first.
 *
 * Kept as a pure function so the priority order is explicit and tested instead
 * of living as a long if-chain inside the app shell. `reading` returns
 * "reading" because the full-window view owns its own Escape. */
export type EscapeLayer =
  | "reading"
  | "palette"
  | "shortcuts"
  | "reset"
  | "export"
  | "reminder"
  | "reminderList"
  | "library"
  | "stats"
  | "restore"
  | "preferences"
  | "filters"
  | "query"
  | "search"
  | "selection"
  | "none";

export interface EscapeState {
  reading: boolean;
  palette: boolean;
  shortcuts: boolean;
  reset: boolean;
  exportOpen: boolean;
  reminder: boolean;
  reminderList: boolean;
  library: boolean;
  stats: boolean;
  restore: boolean;
  preferences: boolean;
  filters: boolean;
  query: string;
  searchExpanded: boolean;
  selection: boolean;
}

export function escapeLayer(state: EscapeState): EscapeLayer {
  if (state.reading) return "reading";
  if (state.palette) return "palette";
  if (state.shortcuts) return "shortcuts";
  if (state.reset) return "reset";
  if (state.exportOpen) return "export";
  if (state.reminder) return "reminder";
  if (state.reminderList) return "reminderList";
  if (state.library) return "library";
  if (state.stats) return "stats";
  if (state.restore) return "restore";
  if (state.preferences) return "preferences";
  if (state.filters) return "filters";
  if (state.query !== "") return "query";
  if (state.searchExpanded) return "search";
  if (state.selection) return "selection";
  return "none";
}


/** The browser seams the overlay state touches, injectable for tests. */
export interface OverlayDom {
  activeElement: () => HTMLElement | null;
  focus: (target: HTMLElement | null) => void;
  blurActive: () => void;
  afterRender: () => Promise<void>;
}

function browserDom(): OverlayDom {
  return {
    activeElement: () =>
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    focus: (target) => target?.focus(),
    blurActive: () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    afterRender: () => tick(),
  };
}

/** Open dialogs and the selection cursor, plus the opener that focus returns
 * to when the last of them closes. A dialog opened from another one keeps the
 * original opener, so focus never lands on a panel that unmounted. */
export class Overlays {
  palette = $state(false);
  shortcuts = $state(false);
  /** Dialog the shortcuts list came from, so closing it returns there. */
  shortcutsReturn = $state<"preferences" | null>(null);
  /** Popover that filters the list; it never makes the shell inert. */
  filters = $state(false);
  preferences = $state(false);
  reminder = $state(false);
  reminderList = $state(false);
  selectedId = $state<number | null>(null);
  #opener: HTMLElement | null = null;

  constructor(private readonly dom: OverlayDom = browserDom()) {}

  rememberOpener(): void {
    if (this.#opener !== null && this.#opener.isConnected) return;
    this.#opener = this.dom.activeElement();
  }

  /** Hand the opener to another surface (the reading view) and forget it. */
  takeOpener(): HTMLElement | null {
    const opener = this.#opener;
    this.#opener = null;
    return opener;
  }

  /** Give focus back once the dialog unmounted and the shell is not inert. */
  restoreOpener(fallback: HTMLElement | null): void {
    const opener = this.takeOpener();
    void this.dom.afterRender().then(() => {
      const target = opener !== null && opener.isConnected ? opener : fallback;
      this.dom.focus(target);
    });
  }

  openShortcuts(returnTo: "preferences" | null = null): void {
    if (this.shortcuts) return;
    this.rememberOpener();
    this.shortcutsReturn = returnTo;
    this.shortcuts = true;
  }

  /** The list replaced Preferences, so closing it must land back there. */
  get shortcutsFromPreferences(): boolean {
    return this.shortcutsReturn === "preferences";
  }

  closeShortcuts(fallback: HTMLElement | null): void {
    if (!this.shortcuts) return;
    const returnTo = this.shortcutsReturn;
    this.shortcuts = false;
    this.shortcutsReturn = null;
    if (returnTo === "preferences") {
      // Keep the opener: the shell gets it back when Preferences closes.
      this.preferences = true;
      return;
    }
    this.restoreOpener(fallback);
  }

  openPalette(blocked: boolean): void {
    if (this.palette || blocked) return;
    this.rememberOpener();
    this.palette = true;
  }

  closePalette(fallback: HTMLElement | null): void {
    if (!this.palette) return;
    this.palette = false;
    this.restoreOpener(fallback);
  }

  /** The reminder dialog belongs to one clipping; the shell owns which. */
  openReminder(): void {
    if (this.reminder) return;
    this.rememberOpener();
    this.reminder = true;
  }

  closeReminder(fallback: HTMLElement | null): void {
    if (!this.reminder) return;
    this.reminder = false;
    this.restoreOpener(fallback);
  }

  /** The reminders panel: one layer above the shell, below the edit dialog. */
  openReminderList(): void {
    if (this.reminderList) return;
    this.rememberOpener();
    this.reminderList = true;
  }

  closeReminderList(fallback: HTMLElement | null): void {
    if (!this.reminderList) return;
    this.reminderList = false;
    this.restoreOpener(fallback);
  }

  /** Edit from the panel: hide the list and show the dialog, same opener. */
  handOffReminderListToDialog(): void {
    this.reminderList = false;
    this.reminder = true;
  }

  /** The dialog closed back into the panel it came from. */
  returnToReminderList(): void {
    this.reminder = false;
    this.reminderList = true;
  }

  openFilters(): void {
    this.filters = true;
  }

  closeFilters(): void {
    this.filters = false;
  }

  openPreferences(): void {
    if (this.preferences) return;
    this.rememberOpener();
    this.preferences = true;
  }

  /** `restoreFocus: false` when another dialog takes over the screen. */
  closePreferences(fallback: HTMLElement | null, restoreFocus = true): void {
    if (!this.preferences) return;
    this.preferences = false;
    if (restoreFocus) {
      this.restoreOpener(fallback);
    }
  }

  select(id: number | null): void {
    this.selectedId = id;
  }

  /** Escape on a selection clears it and drops the focus ring. */
  clearSelection(): void {
    this.selectedId = null;
    this.dom.blurActive();
  }
}
