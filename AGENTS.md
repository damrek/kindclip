# AGENTS.md

kindclip is a Tauri 2 desktop app for Kindle clippings: Svelte 5 + TypeScript UI
in `src/`, Rust shell and file I/O in `src-tauri/`, and a pure parser crate in
`crates/clippings-parser/`.

## Commands

- `npx tauri dev` — run the app. `npm run dev` alone has no Tauri IPC bridge.
- `npm run verify` — check + lint + test + comment ratchet, run in parallel. It
  does not build or cover Rust.
- `npm run build` — must run before **any** `cargo build`/`test` on a clean tree:
  `generate_context!` validates `frontendDist` at compile time and `dist/` is
  gitignored.
- Rust gates: `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test --workspace`.
- One frontend test: `npx vitest run src/lib/db.test.ts` or
  `npx vitest run -t "test name"`.
- One crate: `cargo test -p clippings-parser` or `cargo test -p kindclip commands::`
  (append a test-name filter).
- Requires Node 22.22+/24.15+/26+ and stable Rust; Linux system packages are
  listed in the README.

## Non-default rules

- **Comments are banned except in the ratchet.** `.comments-baseline.json`
  allows a shrinking per-file count. New comments fail `npm run lint`
  (JS/TS/Svelte) or `npm run comments` (Rust, SQL, CSS, YAML, TOML, shell). After
  deleting a comment run `npm run comments:update`; the baseline must also shrink
  or the gate fails. Never run `scripts/comments.mjs --init` here.
- **Every UI string goes through i18n.** Five locales — `es`, `en`, `fr`, `de`,
  `it`; Spanish is the default. Add a key to all five dictionaries in
  `src/lib/i18n.ts`; tests require identical key sets and no empty values.
- **Migrations are append-only.** Add the next numbered file under
  `src-tauri/migrations/` and register it in the migration vector in
  `src-tauri/src/lib.rs`. Never edit an applied migration. The SQLite test
  applies only the migrations it lists, so add a new one there when a query
  depends on it.
- **Register Tauri surface in two places:** new commands go in
  `invoke_handler!` in `src-tauri/src/lib.rs`; a new plugin also needs its
  permissions in `src-tauri/capabilities/default.json`. A missing capability
  fails at runtime, not at build time.
- **Workflow text is tested.** `src/lib/ci-workflows.test.ts` asserts invariants
  in `.github/workflows/*.yml` and `tauri.conf.json`; update it when changing
  those files. `src/lib/comment-ratchet.test.ts` guards the comment scripts.

## Architecture

- `src/lib/db/` is the only place with SQL: it calls `tauri-plugin-sql` through
  the `DbPort` seam, and everything imports from the `src/lib/db` barrel, never a
  submodule. Rust owns parsing, import/export and backup file operations, not the
  application data.
- `src/lib/app/*.svelte.ts` holds rune-based state and orchestration;
  `src/lib/*.ts` holds pure logic. Tauri calls are injected (`tauriImportDeps()`,
  `DbLocationDeps`, `DbPort`) so most tests run in the node environment.
- `crates/clippings-parser/` has no Tauri dependency; parser fixtures live in
  `tests/fixtures/`.
- `docs/` is the hand-written GitHub Pages site (no build step); edit its HTML
  and CSS directly.

## Tests

- Vitest defaults to the node environment. A component test opts into jsdom with
  `// @vitest-environment jsdom` as the first line and uses `src/test/component.ts`
  (`installDomStubs`, `testI18n`); cleanup is manual because `autoCleanup` is off.
- `src/lib/db.test.ts` mocks plugin-sql; `src/lib/db.sqlite.test.ts` replays the
  migrations it lists through `node:sqlite`. Use the latter for SQL behavior.

## Releases

- Commit titles are Conventional Commits and drive the version bump:
  `feat` → minor, `fix`/`perf`/`refactor` → patch, `!`/`BREAKING CHANGE` →
  major. `chore`, `docs`, `ci` and test-only commits alone ship nothing.
- A release commit updates `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, both `Cargo.toml` files, `Cargo.lock`, the
  `data-release-version` badge in `docs/index.html`, and adds the
  `CHANGELOG.md` section (user-visible entries only). The release workflow
  refuses a tag whose version disagrees with the four checked version files.
- The PR template asks for a one-line user-facing release note; it becomes the
  CHANGELOG entry at release time.

## Project memory

- Read `MEMORY.md` before working here, and keep it updated when you establish a
  durable technical decision or the fix for a recurring error. It records
  verified, lasting knowledge only; task state belongs in the issue or plan.
