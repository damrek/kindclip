# MEMORY.md

Durable, verified project memory for AI agents. Record decisions and recurring
fixes here, not task state or history. Keep it short and update it when the code
contradicts it.

## Project summary

- kindclip is a local-only desktop viewer for Kindle `My Clippings.txt`: import,
  search/filter, favorites, tags, inline note edits, reminders, stats, export
  (Markdown/JSON/CSV), backups and signed auto-update.
- Tauri 2 shell; the Svelte 5 frontend owns the UI and all application SQL, while
  Rust owns file I/O plus import/export/backup commands.
- `crates/clippings-parser` is a pure parser (no Tauri dependency) shared by the
  Rust import command and its own tests.

## Stack and tools

- Svelte 5 with runes, TypeScript 5.9 (`strict`, `noUnusedLocals`,
  `noUnusedParameters`), Vite 8, Tailwind CSS 4 via the Vite plugin.
- No router or state library: `src/App.svelte` orchestrates, `src/lib/app/*.svelte.ts`
  holds rune state, `src/lib/*.ts` holds pure logic.
- Rust stable, edition 2021, Cargo workspace with `src-tauri` and
  `crates/clippings-parser`.
- SQLite through `tauri-plugin-sql`; the database is `kindclip.db` in the
  per-OS config dir for identifier `app.kindclip`.
- Tauri plugins: dialog, clipboard-manager, opener, log, notification, updater,
  process, window-state.
- Vitest 5, Testing Library + jsdom for component tests, ESLint flat config with
  typescript-eslint and eslint-plugin-svelte, `svelte-check`, rustfmt/clippy.
  No Prettier and no `tailwind.config`.
- npm is the package manager; Node 22.22+/24.15+/26+.
- `docs/` is the hand-written GitHub Pages site, published as-is with no build.

## Essential commands

```bash
npm install
npx tauri dev                 # never `npm run dev`: no Tauri IPC bridge
npm run build                 # dist/ is gitignored and required by Rust builds
npm run verify                # check + lint + test + comment ratchet, parallel
npx vitest run src/lib/db.test.ts
npx vitest run -t "test name"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p clippings-parser
cargo test -p kindclip commands::
```

- Run `npm run build` before any `cargo build`/`test` on a clean tree:
  `generate_context!` validates `frontendDist` at compile time.
- `npm run coverage` exists but is on demand; it is not part of `verify`.
- Linux system dependencies are listed in the README.

## Conventions and patterns

- Comments are banned except for the per-file allowance in
  `.comments-baseline.json`, which may only shrink. Delete comments instead of
  adding them; after deleting, run `npm run comments:update`. Never run
  `scripts/comments.mjs --init`.
- Tool directives (`@vitest-environment`, `svelte-ignore`, `eslint-disable`,
  `@ts-expect-error`, `<reference>`) are not treated as comments.
- All UI text goes through `src/lib/i18n.ts` in five locales: `es` (default),
  `en`, `fr`, `de`, `it`. Every locale must have identical keys and no empty
  values.
- Application SQL belongs only in `src/lib/db/`. Import from the `src/lib/db`
  barrel, never a submodule, and keep `DbPort` as the test seam.
- Migrations are append-only numbered files in `src-tauri/migrations/`,
  registered in the migration vector in `src-tauri/src/lib.rs`; never edit an
  applied migration.
- New Tauri commands are registered in `invoke_handler!`; a new plugin also
  needs permissions in `src-tauri/capabilities/default.json`. Rust commands
  reject with `{ code, message }` (`CommandError`), and the frontend formats it
  with `describeError`/`commandError`.
- Pure modules accept injected dependencies (`DbPort`, `tauriImportDeps()`,
  `DbLocationDeps`) so most tests run in the node environment.
- Tests are co-located as `*.test.ts`. A component test needs
  `// @vitest-environment jsdom` as its first line and `src/test/component.ts`
  (`installDomStubs`, `testI18n`); cleanup is manual.
- `src/lib/db.test.ts` mocks `@tauri-apps/plugin-sql`;
  `src/lib/db.sqlite.test.ts` replays its listed migrations through `node:sqlite`.
- Logging and localStorage are best-effort: failures are swallowed so they never
  break the operation. Logs never include clipping text, notes or queries.
- Theming uses semantic CSS tokens in `src/app.css`; `data-mode` controls light
  vs dark and `data-palette` selects the palette.
- Commit titles are Conventional Commits and drive releases: `feat` minor,
  `fix`/`perf`/`refactor` patch, `!`/`BREAKING CHANGE` major. `chore`, `docs`,
  `ci` and test-only commits alone ship nothing.

## Critical points / Gotchas

- `dist/` is gitignored; a missing build makes Rust compilation fail before any
  test runs.
- A missing Tauri capability fails at runtime, not at build time.
- Release commits must agree across `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and `crates/clippings-parser/Cargo.toml`; the release
  workflow refuses mismatches. The same commit updates `package-lock.json`,
  `Cargo.lock`, the `data-release-version` badge in `docs/index.html`, and adds
  the `CHANGELOG.md` section (user-visible entries only).
- Signing a local release needs `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; never commit their values. The public key
  is embedded in `tauri.conf.json`.
- `.github/workflows/*.yml` and `tauri.conf.json` are asserted textually by
  `src/lib/ci-workflows.test.ts`; update that test with workflow changes.
  `src/lib/comment-ratchet.test.ts` guards the comment tooling.
- `npm run dev` alone serves the UI but shows a message instead of running the
  app; use `npx tauri dev`.
- The app opens one shared SQLite connection, runs migrations at startup and
  backfills search folding; restore closes and reopens it.
- `odd/`, `.atl/`, `.svelte-check/` and logs are local or generated; don't treat
  them as source.
