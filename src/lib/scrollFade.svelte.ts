import { hasMoreBelow, type ScrollMetrics } from "./scroll";

/** The browser seams the fade touches, injectable for tests. */
export interface ScrollFadeDom {
  /** Call `measure` on scroll, on resize and on content changes; returns the stop. */
  watch: (node: HTMLElement, measure: () => void) => () => void;
}

function browserDom(): ScrollFadeDom {
  return {
    watch: (node, measure) => {
      const resize = new ResizeObserver(measure);
      const mutations = new MutationObserver(measure);
      resize.observe(node);
      mutations.observe(node, { childList: true, subtree: true, characterData: true });
      node.addEventListener("scroll", measure, { passive: true });
      return () => {
        resize.disconnect();
        mutations.disconnect();
        node.removeEventListener("scroll", measure);
      };
    },
  };
}

/** Whether one scroll container still hides rows below the fold, kept current
 * while it scrolls, resizes or its content changes.
 *
 * Render the overlay from `moreBelow` and attach with `use:fade.track`:
 *
 * ```svelte
 * <div use:fade.track class="overflow-y-auto">…</div>
 * <ScrollFadeOverlay visible={fade.moreBelow} class="inset-x-0 bottom-0 h-8" />
 * ``` */
export class ScrollFade {
  moreBelow = $state(false);
  /** Only the geometry is read, so a real element and a test double both fit. */
  #node: ScrollMetrics | null = null;
  #stop: (() => void) | null = null;

  constructor(private readonly dom: ScrollFadeDom = browserDom()) {}

  track = (node: HTMLElement): { destroy: () => void } => {
    this.#stop?.();
    this.#node = node;
    this.#stop = this.dom.watch(node, this.measure);
    this.measure();
    // The action can run before its children are in the DOM; one microtask
    // still lands before the first paint, so the fade is never a frame late.
    queueMicrotask(this.measure);
    return {
      destroy: () => {
        this.#stop?.();
        this.#stop = null;
        this.#node = null;
        this.moreBelow = false;
      },
    };
  };

  measure = (): void => {
    const node = this.#node;
    this.moreBelow = node !== null && hasMoreBelow(node);
  };
}
