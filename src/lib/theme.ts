/**
 * Theme selection: a light/dark mode axis plus a dark palette axis.
 *
 * Both are applied as attributes on the document element:
 * - `data-mode`    "light" | "dark" — drives `color-scheme` and `dark:`
 * - `data-palette` palette id       — drives the token block in app.css
 *
 * Keeping them separate keeps "system" honest: the OS decides the mode, the
 * user still decides which dark palette that mode renders.
 */

export type ThemeMode = "system" | "light" | "dark";
export type DarkPalette = "atom-one-dark" | "darcula" | "nord" | "solarized-dark";
export type ThemePalette = DarkPalette | "light";
export type EffectiveMode = "light" | "dark";

export interface ResolvedTheme {
  mode: EffectiveMode;
  palette: ThemePalette;
}

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
export const DARK_PALETTES: DarkPalette[] = [
  "atom-one-dark",
  "darcula",
  "nord",
  "solarized-dark",
];
export const DEFAULT_DARK_PALETTE: DarkPalette = "atom-one-dark";

/** Display names. Palette names are proper nouns, so they stay untranslated. */
export const DARK_PALETTE_NAMES: Record<DarkPalette, string> = {
  "atom-one-dark": "Atom One Dark",
  darcula: "Darcula",
  nord: "Nord",
  "solarized-dark": "Solarized Dark",
};

const MODE_STORAGE_KEY = "kindclip-theme";
const PALETTE_STORAGE_KEY = "kindclip-dark-palette";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function isDarkPalette(value: unknown): value is DarkPalette {
  return (
    typeof value === "string" && (DARK_PALETTES as readonly string[]).includes(value)
  );
}

/** Mode picks light/dark; the palette only matters when the result is dark. */
export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
  palette: DarkPalette,
): ResolvedTheme {
  const effective: EffectiveMode =
    mode === "light" ? "light" : mode === "dark" ? "dark" : systemDark ? "dark" : "light";
  return {
    mode: effective,
    palette: effective === "light" ? "light" : palette,
  };
}

/** Add/replace the attributes Tailwind's variant and app.css key on. */
export function applyTheme(element: HTMLElement, resolved: ResolvedTheme): void {
  element.dataset.mode = resolved.mode;
  element.dataset.palette = resolved.palette;
}

export function loadThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isThemeMode(stored)) {
      return stored;
    }
  } catch {
    // Private mode or unavailable storage: fall back to system.
  }
  return "system";
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Non-fatal: the mode simply won't persist.
  }
}

export function loadDarkPalette(): DarkPalette {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (isDarkPalette(stored)) {
      return stored;
    }
  } catch {
    // Private mode or unavailable storage: fall back to the default palette.
  }
  return DEFAULT_DARK_PALETTE;
}

export function saveDarkPalette(palette: DarkPalette): void {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Non-fatal: the palette simply won't persist.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
