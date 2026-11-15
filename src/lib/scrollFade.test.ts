import { describe, expect, it } from "vitest";
import { ScrollFade, type ScrollFadeDom } from "./scrollFade.svelte";

interface Metrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

function fakeDom() {
  let notify: (() => void) | null = null;
  let stops = 0;
  const dom: ScrollFadeDom = {
    watch: (_node, measure) => {
      notify = measure;
      return () => {
        stops += 1;
        notify = null;
      };
    },
  };
  return {
    dom,
    stops: () => stops,
    watching: () => notify !== null,
    /** Stands in for a scroll, a resize or a content change. */
    changed: () => notify?.(),
  };
}

/** The fade only reads the scroll geometry, so a plain object is enough. */
function scroller(metrics: Metrics): HTMLElement {
  return metrics as unknown as HTMLElement;
}

describe("ScrollFade", () => {
  it("measures the scroller as soon as it is attached", () => {
    const fade = new ScrollFade(fakeDom().dom);
    fade.track(scroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }));

    expect(fade.moreBelow).toBe(true);
  });

  it("stays quiet when the content fits", () => {
    const fade = new ScrollFade(fakeDom().dom);
    fade.track(scroller({ scrollHeight: 320, scrollTop: 0, clientHeight: 400 }));

    expect(fade.moreBelow).toBe(false);
  });

  it("follows the scroller as it moves, resizes or its content changes", () => {
    const fake = fakeDom();
    const fade = new ScrollFade(fake.dom);
    const node = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    fade.track(scroller(node));
    expect(fade.moreBelow).toBe(true);

    node.scrollTop = 600;
    fake.changed();
    expect(fade.moreBelow).toBe(false);

    node.scrollHeight = 2000;
    fake.changed();
    expect(fade.moreBelow).toBe(true);
  });

  it("stops watching and forgets the scroller when it unmounts", () => {
    const fake = fakeDom();
    const fade = new ScrollFade(fake.dom);
    const { destroy } = fade.track(
      scroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }),
    );

    destroy();

    expect(fake.stops()).toBe(1);
    expect(fake.watching()).toBe(false);
    expect(fade.moreBelow).toBe(false);
  });

  it("replaces the watch when it tracks another scroller", () => {
    const fake = fakeDom();
    const fade = new ScrollFade(fake.dom);
    fade.track(scroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }));
    fade.track(scroller({ scrollHeight: 320, scrollTop: 0, clientHeight: 400 }));

    expect(fake.stops()).toBe(1);
    expect(fade.moreBelow).toBe(false);
  });
});
