#!/usr/bin/env bash
# Tests for release-notes.sh. Dependency-free: run with
#   bash .github/scripts/release-notes.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/release-notes.sh"
repo_root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
checks=0

check() { # name expected actual
  local name="$1" expected="$2" actual="$3"
  checks=$((checks + 1))
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL %s\n--- expected ---\n%s\n--- actual ---\n%s\n---\n' \
      "$name" "$expected" "$actual"
    failures=$((failures + 1))
  else
    printf 'ok %s\n' "$name"
  fi
}

check_status() { # name expected actual
  check "$1" "$2" "$3"
}

notes_out=""
notes_status=0
run_notes() {
  set +e
  notes_out=$(bash "$script" "$@" 2>"$tmp/stderr")
  notes_status=$?
  set -e
}

cat >"$tmp/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]

## [2.0.0] - 2026-12-01

### Added

- **Big feature**: a sentence long enough to be wrapped across
  two source lines, with a tail.
- Short bullet.

### Fixed

- One fix that also wraps
  onto a second line.

## [1.0.0] - 2026-01-01

### Added

- First release.
EOF

# 1. Version section, unwrapped, with the comparison footer.
expected="$(cat <<'EOF'
### Added

- **Big feature**: a sentence long enough to be wrapped across two source lines, with a tail.
- Short bullet.

### Fixed

- One fix that also wraps onto a second line.

**Full changelog**: https://github.com/acme/kindclip/compare/v1.0.0...v2.0.0
EOF
)"
run_notes 2.0.0 acme/kindclip "$tmp/CHANGELOG.md"
check_status "section: exit 0" 0 "$notes_status"
check "section: unwrapped body and footer" "$expected" "$notes_out"

# 2. A missing version section exits 1 and prints nothing.
run_notes 3.0.0 acme/kindclip "$tmp/CHANGELOG.md"
check_status "missing section: exit 1" 1 "$notes_status"
check "missing section: no output" "" "$notes_out"

# 3. The oldest release has no previous version, so no footer.
expected="$(cat <<'EOF'
### Added

- First release.
EOF
)"
run_notes v1.0.0 acme/kindclip "$tmp/CHANGELOG.md"
check_status "first release: exit 0" 0 "$notes_status"
check "first release: body without footer" "$expected" "$notes_out"

# 4. Usage errors are distinct from a missing section (exit 2).
set +e
bash "$script" >"$tmp/stdout" 2>"$tmp/stderr"
notes_status=$?
set -e
check_status "usage: exit 2" 2 "$notes_status"
check "usage: no stdout" "" "$(cat "$tmp/stdout")"

# 5. The real CHANGELOG resolves the latest release.
run_notes 1.19.0 damrek/kindclip "$repo_root/CHANGELOG.md"
check_status "real changelog: exit 0" 0 "$notes_status"
case "$notes_out" in
  "### Added"*) check "real changelog: starts with the section body" ok ok ;;
  *) check "real changelog: starts with the section body" "### Added..." "$notes_out" ;;
esac
case "$notes_out" in
  *"- **Searchable author and tag filters**: the author and tag lists in the Filters menu get their own search"*) check "real changelog: continuation joined" ok ok ;;
  *) check "real changelog: continuation joined" "joined bullet" "$notes_out" ;;
esac
case "$notes_out" in
  *"**Full changelog**: https://github.com/damrek/kindclip/compare/v1.18.0...v1.19.0"*) check "real changelog: footer" ok ok ;;
  *) check "real changelog: footer" "footer link" "$notes_out" ;;
esac
case "$notes_out" in
  *"## ["*) check "real changelog: next heading excluded" "no next heading" "found a heading" ;;
  *) check "real changelog: next heading excluded" ok ok ;;
esac
if grep -q '^  ' <<<"$notes_out"; then
  check "real changelog: no wrapped lines remain" "no two-space indent" "found one"
else
  check "real changelog: no wrapped lines remain" ok ok
fi

# 6. A heading with an empty body counts as a missing section (exit 1).
printf '## [4.0.0] - 2026-12-02\n\n## [3.0.0] - 2026-12-01\n\n- old.\n' >"$tmp/empty.md"
run_notes 4.0.0 acme/kindclip "$tmp/empty.md"
check_status "empty section: exit 1" 1 "$notes_status"
check "empty section: no output" "" "$notes_out"

# 7. A non-semver heading after the section is skipped for the previous version.
cat >"$tmp/unreleased-after.md" <<'EOF'
## [5.0.0] - 2026-12-03

- current.

## [Unreleased]

- pending.

## [4.0.0] - 2026-12-02

- old.
EOF
expected="$(cat <<'EOF'
- current.

**Full changelog**: https://github.com/acme/kindclip/compare/v4.0.0...v5.0.0
EOF
)"
run_notes 5.0.0 acme/kindclip "$tmp/unreleased-after.md"
check_status "Unreleased after section: exit 0" 0 "$notes_status"
check "Unreleased after section: previous semver footer" "$expected" "$notes_out"

# 8. A read error is exit 2, distinct from a missing section.
run_notes 5.0.0 acme/kindclip "$tmp/does-not-exist.md"
check_status "read error: exit 2" 2 "$notes_status"

# 9. A whitespace-only section body counts as missing (no trailing-space bullet).
printf '## [6.0.0] - 2026-12-04\n   \n## [5.0.0] - 2026-12-03\n\n- old.\n' >"$tmp/whitespace.md"
run_notes 6.0.0 acme/kindclip "$tmp/whitespace.md"
check_status "whitespace-only section: exit 1" 1 "$notes_status"
check "whitespace-only section: no output" "" "$notes_out"

printf '\n%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
