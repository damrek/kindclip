import { describe, expect, it } from "vitest";
import {
  countText,
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
    "export.perBook",
    "export.folderPrompt",
    "export.overwrite",
    "export.doneFolder",
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

  it("interpolates the done summary with each locale's noun phrases", () => {
    const line = (locale: Locale): string =>
      translate(locale, "import.doneSkipped", {
        inserted: 2,
        total: 5,
        duplicates: countText(locale, "duplicate", 1),
        skipped: countText(locale, "skipped", 2),
        books: countText(locale, "book", 3),
      });

    expect(line("es")).toBe("Importados 2 de 5 (1 duplicado, 2 omitidos, 3 libros).");
    expect(line("en")).toBe("Imported 2 of 5 (1 duplicate, 2 skipped, 3 books).");
    expect(line("fr")).toBe("Importés 2 sur 5 (1 doublon, 2 ignorés, 3 livres).");
    expect(line("de")).toBe("2 von 5 importiert (1 Duplikat, 2 übersprungen, 3 Bücher).");
    expect(line("it")).toBe("Importati 2 di 5 (1 duplicato, 2 saltati, 3 libri).");
  });

  it("interpolates the empty message with the skipped phrase", () => {
    expect(
      translate("en", "import.emptySkipped", {
        path: "/tmp/My Clippings.txt",
        skipped: countText("en", "skipped", 3),
      }),
    ).toBe("No readable clippings in /tmp/My Clippings.txt (3 skipped).");
  });

  it("picks the plural variant declared for the locale", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "library.clippingCount", { count: 1 })).toContain("1 ");
      expect(translate(locale, "library.clippingCount", { count: 2 })).toContain("2 ");
    }
    expect(translate("en", "library.clippingCount", { count: 1 })).toBe("1 clipping");
    expect(translate("en", "library.clippingCount", { count: 2 })).toBe("2 clippings");
    expect(translate("de", "library.clippingCount", { count: 2 })).toBe("2 Clippings");
    expect(translate("es", "export.overwrite", { count: 1 })).toBe(
      "¿Reemplazar 1 archivo existente?",
    );
  });
});

describe("reading view keys", () => {
  it("interpolates the position in every locale", () => {
    const params = { current: 7, total: 137 };
    expect(translate("es", "reading.position", params)).toBe("7 de 137");
    expect(translate("en", "reading.position", params)).toBe("7 of 137");
    expect(translate("fr", "reading.position", params)).toBe("7 sur 137");
    expect(translate("de", "reading.position", params)).toBe("7 von 137");
    expect(translate("it", "reading.position", params)).toBe("7 di 137");
  });

  it("resolves every reading label in every locale", () => {
    const keys = [
      "reading.open",
      "reading.title",
      "reading.close",
      "reading.prev",
      "reading.next",
      "reading.hint",
    ] as const;
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(translate(locale, key), `${locale}.${key}`).not.toBe(key);
      }
    }
  });
});

describe("prefs.versionShort", () => {
  it("interpolates the app version in every locale", () => {
    expect(translate("es", "prefs.versionShort", { version: "1.9.0" })).toBe("v1.9.0");
    expect(translate("en", "prefs.versionShort", { version: "1.9.0" })).toBe("v1.9.0");
    expect(translate("fr", "prefs.versionShort", { version: "1.9.0" })).toBe("v1.9.0");
    expect(translate("de", "prefs.versionShort", { version: "1.9.0" })).toBe("v1.9.0");
    expect(translate("it", "prefs.versionShort", { version: "1.9.0" })).toBe("v1.9.0");
  });
});

describe("preferences compact labels", () => {
  it("keeps each short label shorter than the full text its tooltip shows", () => {
    const pairs = [
      ["prefs.autoBackupShort", "prefs.autoBackup"],
      ["prefs.backupShort", "prefs.backup"],
      ["prefs.restoreShort", "prefs.restore"],
      ["db.openShort", "db.open"],
      ["logs.openShort", "logs.open"],
    ] as const;
    for (const locale of LOCALES) {
      for (const [short, full] of pairs) {
        const label = translate(locale, short);
        expect(label, `${locale}.${short}`).not.toBe(short);
        expect(label.length, `${locale}.${short}`).toBeLessThan(translate(locale, full).length);
      }
    }
  });
});
