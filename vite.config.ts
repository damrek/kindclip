import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";

const { TAURI_DEV_HOST: host, TAURI_ENV_PLATFORM } =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const isTauri = !!TAURI_ENV_PLATFORM;

export default defineConfig(async () => ({
  // `svelteTesting` makes Vitest resolve Svelte's browser runtime (component
  // tests mount for real) instead of its server build. It is inert outside
  // Vitest. Cleanup stays manual so node-environment suites never load the DOM
  // library: each component test calls `setup`/`cleanup` itself.
  plugins: [svelte(), tailwindcss(), svelteTesting({ autoCleanup: false })],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: isTauri
    ? undefined
    : {
        environment: "node",
        // Threads start cheaper than the default forks for a suite this small.
        pool: "threads",
        // Persist transformed modules between runs. The cache lives inside
        // node_modules, so reinstalling dependencies invalidates it naturally.
        fsModuleCache: true,
        coverage: {
          provider: "v8",
          // On demand (`npm run coverage`), never part of `npm run verify`:
          // instrumentation costs more than the whole gate saves. The text
          // table answers "what is not covered"; the html report drills down.
          reporter: ["text", "html"],
          include: ["src/**/*.{ts,svelte}"],
          exclude: ["src/**/*.test.ts", "src/test/**", "src/**/*.d.ts"],
          // A number picked before the first report would only force a fake
          // gate, so coverage stays a map of the gaps for now.
          reportsDirectory: "coverage",
        },
      },
}));
