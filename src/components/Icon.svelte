<script lang="ts">
  /** Monochrome toolbar icons (Lucide-style paths) so the chrome matches macOS. */
  type IconName =
    | "sidebar"
    | "search"
    | "filter"
    | "more"
    | "folder"
    | "library"
    | "export"
    | "close";

  interface Props {
    name: IconName;
    class?: string;
  }

  const { name, class: className = "h-4 w-4" }: Props = $props();

  const PATHS: Record<IconName, string[]> = {
    sidebar: ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 3v18"],
    search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
    filter: ["M4 5h16l-6 7v6l-4 2v-8z"],
    more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
    folder: [
      "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    ],
    library: ["M4 6h16", "M4 12h16", "M4 18h10"],
    export: ["M12 15V3", "M8 7l4-4 4 4", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
    close: ["M6 6l12 12", "M18 6L6 18"],
  };
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={name === "more" ? 2.6 : 1.7}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] as path (path)}
    <path d={path} />
  {/each}
</svg>
