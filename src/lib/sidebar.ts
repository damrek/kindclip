/** Sidebar visibility (UX polish): persisted like the theme/font caches. */
import { readStored, writeStored } from "./storage";

const STORAGE_KEY = "kindclip-sidebar-open";
const VIEW_KEY = "kindclip-sidebar-view";

/** Flat book list (default) or books grouped by author (S7). */
export type SidebarView = "books" | "authors";

export function loadSidebarView(stored: string | null): SidebarView {
  return stored === "authors" ? "authors" : "books";
}

export function readSidebarView(): SidebarView {
  return loadSidebarView(readStored(VIEW_KEY));
}

export function saveSidebarView(view: SidebarView): void {
  writeStored(VIEW_KEY, view);
}

export function loadSidebarOpen(stored: string | null): boolean {
  return stored !== "closed";
}

export function readSidebarOpen(): boolean {
  return loadSidebarOpen(readStored(STORAGE_KEY));
}

export function saveSidebarOpen(open: boolean): void {
  writeStored(STORAGE_KEY, open ? "open" : "closed");
}
