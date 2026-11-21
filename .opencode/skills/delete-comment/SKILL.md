---
name: Delete Comment
description: Audit code comments, delete tautologies/stale/excuses, and keep only decision records. Use when asked to clean up comments, run /delete-comment, or maintain the comment ratchet.
---

# Delete Comment

Audit comments across the repository and delete everything that is not a
decision record. The repository bans comments through a ratcheted baseline:
`.comments-baseline.json` lists the comments that are still allowed, and it may
only shrink.

## Rubric

Classify every comment as exactly one of:

| Class | Operational test | Action |
| --- | --- | --- |
| Tautology | A competent reader learns nothing beyond the identifier, type or literal next to it. | Delete |
| Stale | Names a file, symbol, spec ID, version or behaviour that no longer exists (spec IDs from `odd/` are dangling because `odd/` is gitignored). | Delete, or fix the reference when the rest is a decision record |
| Excuse | Justifies a shortcut, missing test, ignored failure or temporary behaviour ("for now", "not unit tested", "we don't handle"). | Delete and create an ODD task that closes the gap |
| Decision Record | Encodes a non-obvious contract: ordering, invariants, external-system quirks, safety consequences, cross-file agreements, formats. | Keep |

Do not classify tool directives as comments. `@vitest-environment`,
`svelte-ignore`, `eslint-disable`, `@ts-expect-error`, `prettier-ignore` and
`<reference>` lines stay: removing them changes tooling.

## Workflow

1. Inventory before touching anything:
   `npm run comments:stats` gives units, lines and files.
2. Read each unit in context. A comment is only a tautology if the adjacent code
   already says the same thing; "why" comments are decision records even when
   short.
3. Delete per file from the bottom up so line numbers stay valid. Delete whole
   comment lines; for a trailing comment, keep the code line.
4. Fix dangling references instead of deleting a decision record: replace a dead
   path, strip `S#`/`T#`/`V#`/`(roadmap)` tokens, keep the rationale.
5. For an Excuse, delete the comment and write `odd/tasks/<slug>.md` using the
   repository's ODD shape (Specs, Tasks, Log with the verbatim finding).
6. Tighten the ratchet: `npm run comments:update`. It only lowers or prunes
   entries; it never grandfathers a new comment.
7. Run `npm run verify` (check, lint, test, comments). For Rust edits also run
   `cargo fmt --check`.

## Ratchet commands

| Command | Effect |
| --- | --- |
| `npm run comments` | Fails on a new comment in Rust, SQL, shell, CSS, YAML or TOML |
| `npm run lint` | Runs the `kindclip/no-comments` ESLint rule for JS, TS and Svelte |
| `npm run comments:update` | Lowers/prunes `.comments-baseline.json` to the current state |
| `npm run comments:stats` | Prints comment units/lines/files |

`node scripts/comments.mjs --init` exists only to bootstrap the baseline in a
repository that has none. Never run it in this repository: it can raise the
baseline and grandfather new comments.

## Decision-record examples from this repository

- "Mark first: the desktop plugin reports no send failure, so a row whose
  delivery cannot be recorded is skipped instead of notified twice."
- "GitHub scopes caches to a ref: a tag run can read the default-branch cache
  but never another tag's. Any cache here would be a silent no-op."
- "sqlx binds `$N` by its numeric name, so reusing `$1..$11` would feed the first
  row's values to the whole batch."

## Tautology and excuse examples

- "Bottom fade of the list, measured against the scroller." on
  `const fade = new ScrollFade()` — delete.
- "Deterministic hash over the normalized entry fields." on
  `pub fn hash_of(...)` — delete.
- "Not unit tested: resolving `download_dir` requires a live `AppHandle`." —
  delete the comment and fix the seam in an ODD task.

## Reporting

Report the counts by class, the files touched, the lines removed, and any
Excuse that produced an ODD task. Also report the hypothetical: how many lines
disappear if every remaining comment is deleted.
