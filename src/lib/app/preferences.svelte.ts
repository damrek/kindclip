/** Locale, theme, palette, font scale and the auto-backup preference.
 *
 * The module owns the state, the fast localStorage cache that the pre-paint
 * script reads, and the DB hydration rules; the DOM application arrives as a
 * dependency so `hydrate` can be tested without a document. */
import { SETTINGS_KEYS } from "../db";
import { loadFontScale, saveFontScale, type FontScale } from "../font";
import {
  isLocale,
  loadLocale,
  translate,
  type I18nKey,
  type Locale,
  type TranslateParams,
} from "../i18n";
import {
  isDarkPalette,
  isThemeMode,
  loadDarkPalette,
  loadThemeMode,
  saveDarkPalette,
  saveThemeMode,
  type DarkPalette,
  type ThemeMode,
} from "../theme";

const LOCALE_KEY = "kindclip-locale";
const FONT_KEY = "kindclip-font-scale";
const FONT_SCALES: FontScale[] = ["small", "medium", "large"];

/** Best-effort read: private mode or blocked storage falls back to null. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the choice simply won't survive a restart.
  }
}

export interface PreferencesDeps {
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
  /** Apply to the document element (or a stub in tests). */
  applyTheme: (mode: ThemeMode, palette: DarkPalette) => void;
  applyFontScale: (scale: FontScale) => void;
  log: (scope: string, error: unknown) => void;
}

export class Preferences {
  locale = $state<Locale>(loadLocale(readStored(LOCALE_KEY)));
  themeMode = $state<ThemeMode>(loadThemeMode());
  darkPalette = $state<DarkPalette>(loadDarkPalette());
  fontScale = $state<FontScale>(loadFontScale(readStored(FONT_KEY)));
  /** Daily snapshot preference; on unless the user turned it off. */
  autoBackupEnabled = $state(true);

  constructor(private readonly deps: PreferencesDeps) {}

  /** Bound translator, safe to pass around as a plain function. */
  t = (key: I18nKey, params?: TranslateParams): string =>
    translate(this.locale, key, params);

  setLocale(next: Locale): void {
    this.locale = next;
    writeStored(LOCALE_KEY, next);
    void this.persistSetting(SETTINGS_KEYS.locale, next);
  }

  setTheme(next: ThemeMode): void {
    this.themeMode = next;
    saveThemeMode(next); // fast cache for the pre-paint script
    this.applyCurrentTheme();
    void this.persistSetting(SETTINGS_KEYS.theme, next);
  }

  setDarkPalette(next: DarkPalette): void {
    this.darkPalette = next;
    saveDarkPalette(next);
    this.applyCurrentTheme();
    void this.persistSetting(SETTINGS_KEYS.darkPalette, next);
  }

  setFontScale(next: FontScale): void {
    this.fontScale = next;
    saveFontScale(next);
    this.deps.applyFontScale(next);
    void this.persistSetting(SETTINGS_KEYS.fontScale, next);
  }

  setAutoBackup(next: boolean): void {
    this.autoBackupEnabled = next;
    void this.persistSetting(SETTINGS_KEYS.autoBackup, next ? "1" : "0");
  }

  /** Reads the current state, so an `$effect` that calls it tracks both. */
  applyCurrentTheme(): void {
    this.deps.applyTheme(this.themeMode, this.darkPalette);
  }

  applyCurrentFont(): void {
    this.deps.applyFontScale(this.fontScale);
  }

  /** DB is the source of truth; the localStorage cache only seeds first paint.
   * Unknown or invalid stored values are replaced with the default in the DB. */
  async hydrate(): Promise<void> {
    try {
      const [dbLocale, dbTheme, dbPalette, dbFontScale, dbAutoBackup] = await Promise.all([
        this.deps.getSetting(SETTINGS_KEYS.locale),
        this.deps.getSetting(SETTINGS_KEYS.theme),
        this.deps.getSetting(SETTINGS_KEYS.darkPalette),
        this.deps.getSetting(SETTINGS_KEYS.fontScale),
        this.deps.getSetting(SETTINGS_KEYS.autoBackup),
      ]);

      if (dbLocale !== null && isLocale(dbLocale)) {
        this.locale = dbLocale;
      } else {
        await this.deps.setSetting(SETTINGS_KEYS.locale, this.locale);
      }

      if (isDarkPalette(dbPalette)) {
        this.darkPalette = dbPalette;
        saveDarkPalette(dbPalette);
      } else {
        await this.deps.setSetting(SETTINGS_KEYS.darkPalette, this.darkPalette);
      }

      if (isThemeMode(dbTheme)) {
        this.themeMode = dbTheme;
        saveThemeMode(dbTheme);
      } else {
        await this.deps.setSetting(SETTINGS_KEYS.theme, this.themeMode);
      }

      if (dbFontScale !== null && FONT_SCALES.includes(dbFontScale as FontScale)) {
        this.fontScale = dbFontScale as FontScale;
        saveFontScale(this.fontScale);
      } else {
        await this.deps.setSetting(SETTINGS_KEYS.fontScale, this.fontScale);
      }

      if (dbAutoBackup === "0") {
        this.autoBackupEnabled = false;
      } else {
        this.autoBackupEnabled = true;
        if (dbAutoBackup === null) {
          await this.deps.setSetting(SETTINGS_KEYS.autoBackup, "1");
        }
      }

      this.applyCurrentTheme();
      this.applyCurrentFont();
    } catch (error) {
      // Non-fatal: the app works with the cached/default values.
      this.deps.log("preferences-load", error);
    }
  }

  /** Public so callers can store settings that live outside this module. */
  async persistSetting(key: string, value: string): Promise<void> {
    try {
      await this.deps.setSetting(key, value);
    } catch (error) {
      // Preferences must never break the UI.
      this.deps.log("preferences-save", error);
    }
  }
}
