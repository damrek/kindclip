/** Theme switcher logic (T7): system/light/dark with localStorage. */

export type ThemeChoice = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "kindclip-theme";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): EffectiveTheme {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  if (choice === "system") return "light";
  if (choice === "light") return "dark";
  return "system";
}

/** Add/remove the `.dark` class Tailwind's custom variant keys on. */
export function applyThemeClass(element: HTMLElement, effective: EffectiveTheme): void {
  element.classList.toggle("dark", effective === "dark");
}

export function loadThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private mode or unavailable storage: fall back to system.
  }
  return "system";
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Non-fatal: the theme simply won't persist.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
