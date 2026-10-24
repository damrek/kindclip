/** Sidebar visibility (UX polish): persisted like the theme/font caches. */

const STORAGE_KEY = "kindclip-sidebar-open";

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
