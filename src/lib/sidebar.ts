/** Sidebar visibility (UX polish): persisted like the theme/font caches. */

const STORAGE_KEY = "kindclip-sidebar-open";
const VIEW_KEY = "kindclip-sidebar-view";

/** Flat book list (default) or books grouped by author (S7). */
export type SidebarView = "books" | "authors";

export function loadSidebarView(stored: string | null): SidebarView {
  return stored === "authors" ? "authors" : "books";
}

export function readSidebarView(): SidebarView {
  try {
    return loadSidebarView(localStorage.getItem(VIEW_KEY));
  } catch {
    return "books";
  }
}

export function saveSidebarView(view: SidebarView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Non-fatal: the view simply won't persist.
  }
}

export function loadSidebarOpen(stored: string | null): boolean {
  return stored !== "closed";
}

export function readSidebarOpen(): boolean {
  try {
    return loadSidebarOpen(localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

export function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Non-fatal: the sidebar simply won't persist.
  }
}
