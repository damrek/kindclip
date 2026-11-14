#!/usr/bin/env bash
# Builds the GitHub release body from the CHANGELOG.md section of one version.
#
#   release-notes.sh <version> <owner/repo> [changelog]
#
# Prints the body to stdout. CHANGELOG.md is hard-wrapped for the repository
# file view, but GitHub release bodies render soft line breaks as <br>, so the
# section is unwrapped to one line per bullet or paragraph. The body ends with a
# comparison link when an older released version exists below the section.
#
# Exit codes: 0 body built, 1 version section missing (the caller falls back to
# --generate-notes), 2 usage or read error.
set -euo pipefail

version="${1:-}"
repo="${2:-}"
changelog="${3:-CHANGELOG.md}"

if [ -z "$version" ] || [ -z "$repo" ]; then
  echo "usage: release-notes.sh <version> <owner/repo> [changelog]" >&2
  exit 2
fi
version="${version#v}"
heading="## [$version]"

if [ ! -r "$changelog" ]; then
  echo "cannot read $changelog" >&2
  exit 2
fi

# Raw section: every line after our heading until the next "## [" heading.
section=$(awk -v heading="$heading" '
  /^## \[/ {
    if (seen) exit
    if (index($0, heading) == 1) { seen = 1; next }
  }
  seen { print }
  END { if (!seen) exit 1 }
' "$changelog") || exit 1

# A heading with no body is as useless as no heading at all.
if [ -z "$section" ]; then
  exit 1
fi

# Unwrap: a two-space indented line continues the previous output line.
lines=()
while IFS= read -r line; do
  if [[ $line =~ ^[[:space:]]*$ ]]; then
    lines+=("")
    continue
  fi
  if [[ $line == '  '* ]]; then
    trimmed="${line#"${line%%[![:space:]]*}"}"
    last=$((${#lines[@]} - 1))
    if [ "$last" -ge 0 ] && [ -n "${lines[$last]}" ]; then
      lines[$last]="${lines[$last]} $trimmed"
    else
      lines+=("$trimmed")
    fi
    continue
  fi
  lines+=("$line")
done <<<"$section"

# Trim leading and trailing blank lines around the section body.
first=0
end=${#lines[@]}
while [ "$first" -lt "$end" ] && [ -z "${lines[$first]}" ]; do
  first=$((first + 1))
done
while [ "$end" -gt "$first" ] && [ -z "${lines[$((end - 1))]}" ]; do
  end=$((end - 1))
done

# A section made only of blank or whitespace lines has no body.
if [ "$first" -ge "$end" ]; then
  exit 1
fi

for ((i = first; i < end; i++)); do
  printf '%s\n' "${lines[$i]}"
done

# Previous released version: the next semantic-version heading below ours.
previous=$(awk -v heading="$heading" '
  /^## \[/ {
    if (found) {
      line = $0
      sub(/^## \[/, "", line)
      sub(/\].*$/, "", line)
      if (line ~ /^[0-9]+\.[0-9]+\.[0-9]+$/) { print line; exit }
      next
    }
    if (index($0, heading) == 1) found = 1
  }
' "$changelog")

if [ -n "$previous" ]; then
  printf '\n**Full changelog**: https://github.com/%s/compare/v%s...v%s\n' \
    "$repo" "$previous" "$version"
fi
