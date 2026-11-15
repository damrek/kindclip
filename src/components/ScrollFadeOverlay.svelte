<script lang="ts">
  /** Bottom fade for a scroll container: a gradient strip drawn over the last
   * rows while `visible`. The caller owns the position through `class`. */
  interface Props {
    visible: boolean;
    /** Surface behind the rows: the gradient has to end in that colour. */
    tone?: "raised" | "surface";
    /** Position and size of the strip, e.g. `inset-x-0 -bottom-px h-8`. */
    class?: string;
  }

  const { visible, tone = "raised", class: className = "" }: Props = $props();

  const TONES = {
    raised: "from-surface-raised via-surface-raised/80",
    surface: "from-surface via-surface/80",
  };

  const toneClass = $derived(TONES[tone]);
</script>

<!-- The transition only rides the way out: the strip has to be there the moment
     the content overflows (opening the dialog, switching a tab, filtering), and
     a freshly shown strip that faded in reads as a late effect. Reaching the
     end still dissolves it. -->
<div
  aria-hidden="true"
  class="pointer-events-none absolute bg-linear-to-t to-transparent {toneClass} {visible
    ? 'opacity-100'
    : 'opacity-0 transition-opacity duration-150'} {className}"
></div>
