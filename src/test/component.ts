/** Test seams a component needs: the browser stubs jsdom lacks and the i18n
 * context the app provides. */
import { translate, type I18nContext, type Locale } from "../lib/i18n";

/** jsdom has no ResizeObserver, and the scroll fade observes one. Idempotent. */
export function installDomStubs(): void {
  if ("ResizeObserver" in globalThis) {
    return;
  }
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/** The i18n context App provides; `en` keeps queries stable in tests. */
export function testI18n(locale: Locale = "en"): I18nContext {
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    setLocale: () => {},
  };
}
