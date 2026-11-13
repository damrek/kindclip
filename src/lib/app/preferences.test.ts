import { describe, expect, it } from "vitest";
import { Preferences, type PreferencesDeps } from "./preferences.svelte";
import { SETTINGS_KEYS } from "../db";

function fakeDeps(stored: Record<string, string> = {}) {
  const settings = new Map(Object.entries(stored));
  const applied: Array<{ kind: string; value: string }> = [];
  const deps: PreferencesDeps = {
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => {
      settings.set(key, value);
    },
    applyTheme: (mode, palette) => applied.push({ kind: "theme", value: `${mode}:${palette}` }),
    applyFontScale: (scale) => applied.push({ kind: "font", value: scale }),
    log: () => {},
  };
  return { deps, settings, applied };
}

describe("Preferences.hydrate", () => {
  it("applies valid stored values without rewriting them", async () => {
    const { deps, settings, applied } = fakeDeps({
      [SETTINGS_KEYS.locale]: "fr",
      [SETTINGS_KEYS.theme]: "dark",
      [SETTINGS_KEYS.darkPalette]: "nord",
      [SETTINGS_KEYS.fontScale]: "large",
      [SETTINGS_KEYS.autoBackup]: "0",
    });
    const prefs = new Preferences(deps);
    await prefs.hydrate();

    expect(prefs.locale).toBe("fr");
    expect(prefs.themeMode).toBe("dark");
    expect(prefs.darkPalette).toBe("nord");
    expect(prefs.fontScale).toBe("large");
    expect(prefs.autoBackupEnabled).toBe(false);
    expect(applied).toContainEqual({ kind: "theme", value: "dark:nord" });
    expect(applied).toContainEqual({ kind: "font", value: "large" });
    expect(settings.get(SETTINGS_KEYS.theme)).toBe("dark");
  });

  it("replaces unknown values with the defaults", async () => {
    const { deps, settings } = fakeDeps({
      [SETTINGS_KEYS.locale]: "klingon",
      [SETTINGS_KEYS.theme]: "neon",
      [SETTINGS_KEYS.darkPalette]: "neon",
      [SETTINGS_KEYS.fontScale]: "huge",
    });
    const prefs = new Preferences(deps);
    await prefs.hydrate();

    expect(settings.get(SETTINGS_KEYS.locale)).toBe(prefs.locale);
    expect(settings.get(SETTINGS_KEYS.theme)).toBe(prefs.themeMode);
    expect(settings.get(SETTINGS_KEYS.darkPalette)).toBe(prefs.darkPalette);
    expect(settings.get(SETTINGS_KEYS.fontScale)).toBe(prefs.fontScale);
    expect(prefs.fontScale).not.toBe("huge");
  });

  it("defaults the auto-backup preference to on and records it", async () => {
    const { deps, settings } = fakeDeps();
    const prefs = new Preferences(deps);
    await prefs.hydrate();

    expect(prefs.autoBackupEnabled).toBe(true);
    expect(settings.get(SETTINGS_KEYS.autoBackup)).toBe("1");
  });

  it("translates with the hydrated locale", async () => {
    const { deps } = fakeDeps({ [SETTINGS_KEYS.locale]: "en" });
    const prefs = new Preferences(deps);
    await prefs.hydrate();

    expect(prefs.t("header.import")).toBe("Import");
  });

  it("survives a failing settings port", async () => {
    const deps: PreferencesDeps = {
      getSetting: async () => {
        throw new Error("db down");
      },
      setSetting: async () => {},
      applyTheme: () => {},
      applyFontScale: () => {},
      log: () => {},
    };
    const prefs = new Preferences(deps);
    await expect(prefs.hydrate()).resolves.toBeUndefined();
    expect(["es", "en", "fr", "de", "it"]).toContain(prefs.locale);
  });
});

describe("Preferences mutators as plain callbacks", () => {
  it("survives being passed unbound, the way a Svelte prop does", () => {
    const { deps, applied } = fakeDeps();
    const prefs = new Preferences(deps);
    // `onTheme={prefs.setTheme}` hands Svelte a receiver-less function;
    // destructuring reproduces exactly that call shape.
    const { setLocale, setTheme, setDarkPalette, setFontScale, setAutoBackup } = prefs;

    expect(() => setLocale("en")).not.toThrow();
    expect(() => setTheme("dark")).not.toThrow();
    expect(() => setDarkPalette("nord")).not.toThrow();
    expect(() => setFontScale("large")).not.toThrow();
    expect(() => setAutoBackup(false)).not.toThrow();

    expect(prefs.themeMode).toBe("dark");
    expect(prefs.darkPalette).toBe("nord");
    expect(prefs.fontScale).toBe("large");
    expect(prefs.autoBackupEnabled).toBe(false);
    expect(applied).toContainEqual({ kind: "theme", value: "dark:nord" });
    expect(applied).toContainEqual({ kind: "font", value: "large" });
  });
});
