<script lang="ts">
  /** Monochrome toolbar icons (Lucide-style paths) so the chrome matches macOS. */
  type IconName =
    | "sidebar"
    | "search"
    | "filter"
    | "plus"
    | "folder"
    | "bookOpen"
    | "export"
    | "backup"
    | "restore"
    | "chevron"
    | "chevronsDown"
    | "chevronsUp"
    | "close"
    | "back"
    | "expand"
    | "keyboard"
    | "settings"
    | "stats"
    | "edit"
    | "copy"
    | "quote"
    | "check"
    | "star";

  interface Props {
    name: IconName;
    class?: string;
    /** Fill the shape with the text color (state toggles such as the star). */
    filled?: boolean;
  }

  const { name, class: className = "h-4 w-4", filled = false }: Props = $props();

  const PATHS: Record<IconName, string[]> = {
    sidebar: ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 3v18"],
    search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
    filter: ["M4 5h16l-6 7v6l-4 2v-8z"],
    plus: ["M12 5v14", "M5 12h14"],
    folder: [
      "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    ],
    bookOpen: [
      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",
      "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
    ],
    export: ["M12 3v12", "M8 11l4 4 4-4", "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
    backup: ["M3 4h18v4H3z", "M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8", "M10 12h4"],
    restore: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
    chevron: ["M9 18l6-6-6-6"],
    chevronsDown: ["M7 6l5 5 5-5", "M7 13l5 5 5-5"],
    chevronsUp: ["M17 11l-5-5-5 5", "M17 18l-5-5-5 5"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    back: ["M19 12H5", "M12 19l-7-7 7-7"],
    expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
    keyboard: [
      "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
      "M6 10h.01",
      "M10 10h.01",
      "M14 10h.01",
      "M18 10h.01",
      "M8 14h8",
    ],
    settings: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    ],
    stats: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
    edit: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
    copy: [
      "M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
      "M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3",
    ],
    quote: [
      "M9 7H5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h2v1a3 3 0 0 1-3 3",
      "M21 7h-4a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h2v1a3 3 0 0 1-3 3",
    ],
    check: ["M20 6L9 17l-5-5"],
    // Five-point star, symmetric around x=12: outer r=9.4, inner r=4.0.
    star: ["M12 2.7 L14.35 8.86 L20.94 9.2 L15.8 13.34 L17.53 19.7 L12 16.1 L6.47 19.7 L8.2 13.34 L3.06 9.2 L9.65 8.86z"],
  };
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] as path (path)}
    <path d={path} />
  {/each}
</svg>
