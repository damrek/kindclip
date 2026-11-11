<!-- A checklist, not an essay. Delete any section that does not apply. -->

## What

<!-- What changes for the user, in one or two sentences. -->

## Why

<!-- The problem it solves. `Closes #123` when it closes an issue. -->

## How

<!-- The decisions worth reviewing: schema changes, new dependencies, the
     tradeoff you rejected. Skip it when the diff speaks for itself. -->

## Release note

<!-- One user-facing line for CHANGELOG.md, imperative: "Add ...", "Fix ...".
     Write `none` for CI, refactors, tests and docs. -->

```text

```

## Verification

<!-- Report what you ran, not what you intended to run. `npm run build` comes
     first: generate_context! validates frontendDist at compile time, so cargo
     fails on a clean tree without it. CI runs the rest on all three platforms. -->

- [ ] `npm run build`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `cargo test --workspace`
- [ ] `cargo clippy --workspace --all-targets`
- [ ] `cargo fmt --all -- --check`

## Checklist

- [ ] Conventional Commit title (`feat:`, `fix:`, `perf:`…) — the release
      workflow derives the version bump from it, so `chore:`, `docs:` and `ci:`
      alone ship nothing
- [ ] UI change: before/after screenshots in light and dark, and every new
      string translated in es/en/fr/de/it
- [ ] Database change: a new numbered migration, never an edit to one already
      applied, and existing rows keep working
- [ ] User-visible break: called out in the release note and the README
