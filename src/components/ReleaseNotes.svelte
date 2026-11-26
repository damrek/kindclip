<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { logger } from "../lib/log";
  import { parseReleaseNotes, type ReleaseNoteSegment } from "../lib/releaseNotes";

  interface Props {
    notes: string;
  }

  const { notes }: Props = $props();
  const blocks = $derived(parseReleaseNotes(notes));

  function openExternal(href: string): void {
    void openUrl(href).catch((cause) => logger.error("open-release-link", cause));
  }
</script>

{#snippet inline(segments: ReleaseNoteSegment[])}
  {#each segments as segment, index (index)}
    {#if segment.kind === "strong"}
      <strong class="font-medium text-fg">{segment.text}</strong>
    {:else if segment.kind === "code"}
      <code class="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.86em] text-fg">
        {segment.text}
      </code>
    {:else if segment.kind === "link"}
      <a
        href={segment.href}
        target="_blank"
        rel="noreferrer"
        onclick={(event) => {
          event.preventDefault();
          openExternal(segment.href);
        }}
        class="break-words text-accent-text underline decoration-accent/30 underline-offset-2 transition hover:decoration-accent"
      >
        {segment.text}
      </a>
    {:else}
      {segment.text}
    {/if}
  {/each}
{/snippet}

{#each blocks as block, index (index)}
  {#if block.kind === "heading"}
    <h4
      class="mt-5 text-xs font-medium tracking-wide text-fg-muted uppercase first:mt-0"
    >
      {block.text}
    </h4>
  {:else if block.kind === "list"}
    <ul class="mt-2.5 space-y-2.5 first:mt-0">
      {#each block.items as item, itemIndex (itemIndex)}
        <li class="flex gap-2.5 text-sm leading-relaxed text-fg-muted">
          <span class="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true"
          ></span>
          <span class="min-w-0 break-words">{@render inline(item)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2.5 text-sm leading-relaxed break-words text-fg-muted first:mt-0">
      {@render inline(block.content)}
    </p>
  {/if}
{/each}
