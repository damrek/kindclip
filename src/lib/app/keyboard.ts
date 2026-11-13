/** Keyboard dispatch: one table per key path, so the shell only resolves the
 * action and passes the handlers it already owns. */
import type { ShortcutAction } from "../shortcuts";
import type { EscapeLayer } from "./overlays.svelte";

export interface ShortcutHandlers {
  openSearch: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
  toggleSidebar: () => void;
  openFilters: () => void;
  openPreferences: () => void;
  nextClipping: () => void;
  prevClipping: () => void;
  openClipping: () => void;
  toggleFavorite: () => void;
  copyClipping: () => void;
  copyQuote: () => void;
  nextPage: () => void;
  prevPage: () => void;
}

export function dispatchShortcut(action: ShortcutAction, handlers: ShortcutHandlers): void {
  switch (action) {
    case "focus-search":
      handlers.openSearch();
      return;
    case "open-palette":
      handlers.openPalette();
      return;
    case "open-help":
      handlers.openShortcuts();
      return;
    case "toggle-sidebar":
      handlers.toggleSidebar();
      return;
    case "open-filters":
      handlers.openFilters();
      return;
    case "open-preferences":
      handlers.openPreferences();
      return;
    case "next-clipping":
      handlers.nextClipping();
      return;
    case "prev-clipping":
      handlers.prevClipping();
      return;
    case "open-clipping":
      handlers.openClipping();
      return;
    case "toggle-favorite":
      handlers.toggleFavorite();
      return;
    case "copy-clipping":
      handlers.copyClipping();
      return;
    case "copy-quote":
      handlers.copyQuote();
      return;
    case "next-page":
      handlers.nextPage();
      return;
    case "prev-page":
      handlers.prevPage();
  }
}

export interface EscapeHandlers {
  /** Writes in flight refuse their close. */
  busy: () => { export: boolean; library: boolean; restore: boolean };
  closePalette: () => void;
  closeShortcuts: () => void;
  closeReset: () => void;
  closeExport: () => void;
  closeLibrary: () => void;
  closeStats: () => void;
  closeRestore: () => void;
  closePreferences: () => void;
  closeFilters: () => void;
  clearQuery: () => void;
  foldSearch: () => void;
  clearSelection: () => void;
}

export function dispatchEscape(layer: EscapeLayer, handlers: EscapeHandlers): void {
  const busy = handlers.busy();
  switch (layer) {
    case "none":
    case "reading":
      return;
    case "palette":
      handlers.closePalette();
      return;
    case "shortcuts":
      handlers.closeShortcuts();
      return;
    case "reset":
      handlers.closeReset();
      return;
    case "export":
      if (!busy.export) handlers.closeExport();
      return;
    case "library":
      if (!busy.library) handlers.closeLibrary();
      return;
    case "stats":
      handlers.closeStats();
      return;
    case "restore":
      if (!busy.restore) handlers.closeRestore();
      return;
    case "preferences":
      handlers.closePreferences();
      return;
    case "filters":
      handlers.closeFilters();
      return;
    case "query":
      handlers.clearQuery();
      return;
    case "search":
      handlers.foldSearch();
      return;
    case "selection":
      handlers.clearSelection();
  }
}
