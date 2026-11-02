<script lang="ts">
  import { highlightSegments } from "../lib/search";

  interface Props {
    text: string;
    /** Current search query; empty renders the text untouched. */
    query: string;
  }

  const { text, query }: Props = $props();
  const segments = $derived(highlightSegments(text, query));
</script>

{#each segments as segment, index (index)}{#if segment.match}<mark class="rounded-sm bg-amber-200/80 px-0 text-inherit dark:bg-amber-400/30">{segment.text}</mark>{:else}{segment.text}{/if}{/each}
