import { describe, expect, it } from "vitest";
import {
  DICTIONARIES,
  isLocale,
  loadLocale,
  LOCALES,
  translate,
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
