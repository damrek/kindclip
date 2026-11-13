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
