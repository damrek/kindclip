import { describe, expect, it } from "vitest";
import {
  DICTIONARIES,
  isLocale,
  loadLocale,
  LOCALES,
  translate,
  type I18nKey,
  type Locale,
} from "./i18n";

describe("LOCALES", () => {
  it("supports es, en, fr, de and it", () => {
    expect(LOCALES).toEqual(["es", "en", "fr", "de", "it"]);
  });
});

describe("isLocale", () => {
  it("accepts only supported codes", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});

describe("loadLocale", () => {
  it("defaults to Spanish", () => {
    expect(loadLocale(null)).toBe("es");
    expect(loadLocale("pt")).toBe("es");
    expect(loadLocale("")).toBe("es");
  });

  it("keeps a supported stored choice", () => {
    expect(loadLocale("de")).toBe("de");
  });
});

describe("dictionaries", () => {
  it("share exactly the same keys in every locale", () => {
    const reference = Object.keys(DICTIONARIES.es).sort();
    expect(reference.length).toBeGreaterThan(20);
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort()).toEqual(reference);
    }
  });

  it("has no empty translations", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });
});

describe("translate", () => {
  it("resolves keys per locale", () => {
    expect(translate("es", "empty.title")).toBe("Todavía no hay clippings");
    expect(translate("en", "empty.title")).toBe("No clippings yet");
    expect(translate("fr", "kind.bookmark")).toBe("Signet");
    expect(translate("de", "kind.bookmark")).toBe("Lesezeichen");
    expect(translate("it", "kind.bookmark")).toBe("Segnalibro");
  });

  it("interpolates {params}", () => {
    expect(translate("es", "import.progress", { done: 1, total: 2 })).toBe("Importando 1/2…");
    expect(translate("en", "pg.range", { from: 1, to: 20, total: 137 })).toBe("1–20 of 137");
  });

  it("falls back to the key when missing", () => {
    expect(translate("es", "nope.missing" as never)).toBe("nope.missing");
  });

  it("exposes locale as a Locale type", () => {
    const locale: Locale = "it";
    expect(translate(locale, "lang.label")).toBe("Lingua");
  });
});

describe("export keys", () => {
  const EXPORT_KEYS: I18nKey[] = [
    "export.button",
    "export.title",
    "export.format",
    "export.summary",
    "export.scopeAll",
    "export.scopeFiltered",
    "export.includeOriginal",
    "export.done",
    "export.error",
    "export.originalLabel",
  ];

  it("resolves every export key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of EXPORT_KEYS) {
        expect(translate(locale, key), `${locale}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolates count, scope, file and message", () => {
    expect(translate("es", "export.summary", { count: 12, scope: "todos los libros" })).toBe(
      "12 clippings de todos los libros.",
    );
    expect(translate("en", "export.done", { count: 3, file: "kindclip-export.md" })).toBe(
      "Exported 3 clippings to kindclip-export.md.",
    );
    expect(translate("it", "export.error", { message: "boom" })).toBe(
      "Impossibile esportare: boom",
    );
  });
});

describe("import skipped keys", () => {
  const IMPORT_KEYS: I18nKey[] = ["import.doneSkipped", "import.emptySkipped"];

  it("resolves every import key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of IMPORT_KEYS) {
        expect(translate(locale, key), `${locale}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolates the done summary with the skipped count", () => {
    const params = { inserted: 2, total: 5, duplicates: 1, skipped: 2, books: 3 };
    expect(translate("es", "import.doneSkipped", params)).toBe(
      "Importados 2 de 5 (1 duplicados, 2 omitidos, 3 libros).",
    );
    expect(translate("en", "import.doneSkipped", params)).toBe(
      "Imported 2 of 5 (1 duplicates, 2 skipped, 3 books).",
    );
    expect(translate("fr", "import.doneSkipped", params)).toBe(
      "Importés 2 sur 5 (1 doublons, 2 ignorés, 3 livres).",
    );
    expect(translate("de", "import.doneSkipped", params)).toBe(
      "2 von 5 importiert (1 Duplikate, 2 übersprungen, 3 Bücher).",
    );
    expect(translate("it", "import.doneSkipped", params)).toBe(
      "Importati 2 di 5 (1 duplicati, 2 ignorati, 3 libri).",
    );
  });

  it("interpolates the empty message with the skipped count", () => {
    const params = { path: "/tmp/My Clippings.txt", skipped: 3 };
    expect(translate("es", "import.emptySkipped", params)).toBe(
      "Sin clippings legibles en /tmp/My Clippings.txt (3 omitidos).",
    );
    expect(translate("en", "import.emptySkipped", params)).toBe(
      "No readable clippings in /tmp/My Clippings.txt (3 skipped).",
    );
    expect(translate("fr", "import.emptySkipped", params)).toBe(
      "Aucun clipping lisible dans /tmp/My Clippings.txt (3 ignorés).",
    );
    expect(translate("de", "import.emptySkipped", params)).toBe(
      "Keine lesbaren Clippings in /tmp/My Clippings.txt (3 übersprungen).",
    );
    expect(translate("it", "import.emptySkipped", params)).toBe(
      "Nessun clipping leggibile in /tmp/My Clippings.txt (3 ignorati).",
    );
  });
});

describe("prefs.version", () => {
  it("interpolates the app version in every locale", () => {
    expect(translate("es", "prefs.version", { version: "1.9.0" })).toBe("Versión 1.9.0");
    expect(translate("en", "prefs.version", { version: "1.9.0" })).toBe("Version 1.9.0");
    expect(translate("fr", "prefs.version", { version: "1.9.0" })).toBe("Version 1.9.0");
    expect(translate("de", "prefs.version", { version: "1.9.0" })).toBe("Version 1.9.0");
    expect(translate("it", "prefs.version", { version: "1.9.0" })).toBe("Versione 1.9.0");
  });
});
