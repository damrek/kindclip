#!/usr/bin/env bash
# Tests for updater-manifest.sh. Dependency-free apart from jq, which the
# release job already requires: run with
#   bash .github/scripts/updater-manifest.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/updater-manifest.sh"
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

manifest_out=""
manifest_status=0
run_manifest() {
  set +e
  manifest_out=$(bash "$script" "$@" 2>"$tmp/stderr")
  manifest_status=$?
  set -e
}

mkdir -p "$tmp/sigs"

# The asset names a release actually carries (v2.0.0), plus the updater
# artifacts `createUpdaterArtifacts` adds.
cat >"$tmp/assets.json" <<'EOF'
{
  "assets": [
    { "name": "kindclip-2.0.0-1.x86_64.rpm" },
    { "name": "kindclip_2.0.0_amd64.AppImage" },
    { "name": "kindclip_2.0.0_amd64.AppImage.tar.gz" },
    { "name": "kindclip_2.0.0_amd64.AppImage.tar.gz.sig" },
    { "name": "kindclip_2.0.0_amd64.deb" },
    { "name": "kindclip_2.0.0_universal.dmg" },
    { "name": "kindclip_2.0.0_x64-setup.exe" },
    { "name": "kindclip_2.0.0_x64-setup.exe.sig" },
    { "name": "kindclip_universal.app.tar.gz" },
    { "name": "kindclip_universal.app.tar.gz.sig" }
  ]
}
EOF

printf 'linux-signature\n' >"$tmp/sigs/kindclip_2.0.0_amd64.AppImage.tar.gz.sig"
printf 'windows-signature\r\n' >"$tmp/sigs/kindclip_2.0.0_x64-setup.exe.sig"
printf 'macos-signature' >"$tmp/sigs/kindclip_universal.app.tar.gz.sig"

cat >"$tmp/notes.md" <<'EOF'
### Added

- **Reminders**: one per clipping.
EOF

# 1. The full manifest: every platform key, the right URL, and the signature
#    without a trailing newline or CR.
run_manifest "$tmp/assets.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z "$tmp/notes.md"
check "manifest: exit 0" 0 "$manifest_status"

expected_version=$(jq -r '.version' <<<"$manifest_out")
check "manifest: version" "2.0.0" "$expected_version"
expected_date=$(jq -r '.pub_date' <<<"$manifest_out")
check "manifest: pub_date" "2026-11-19T10:00:00Z" "$expected_date"

expected_keys=$(jq -r '.platforms | keys | join(",")' <<<"$manifest_out")
check "manifest: platform keys" "darwin-aarch64,darwin-x86_64,linux-x86_64,windows-x86_64" "$expected_keys"

# The dialog shows "what's new", so the release body has to reach the manifest.
expected_notes="$(cat <<'EOF'
### Added

- **Reminders**: one per clipping.
EOF
)"
check "manifest: notes carried from the release body" "$expected_notes" \
  "$(jq -r '.notes' <<<"$manifest_out")"

expected=$(jq -r '.platforms["linux-x86_64"].url' <<<"$manifest_out")
check "manifest: linux url" \
  "https://github.com/damrek/kindclip/releases/download/v2.0.0/kindclip_2.0.0_amd64.AppImage.tar.gz" \
  "$expected"
expected=$(jq -r '.platforms["linux-x86_64"].signature' <<<"$manifest_out")
check "manifest: linux signature trimmed" "linux-signature" "$expected"

expected=$(jq -r '.platforms["windows-x86_64"].url' <<<"$manifest_out")
check "manifest: windows url" \
  "https://github.com/damrek/kindclip/releases/download/v2.0.0/kindclip_2.0.0_x64-setup.exe" \
  "$expected"
expected=$(jq -r '.platforms["windows-x86_64"].signature' <<<"$manifest_out")
check "manifest: windows signature has no CR" "windows-signature" "$expected"

# 2. The universal macOS bundle answers both architectures.
expected=$(jq -r '.platforms["darwin-x86_64"].url' <<<"$manifest_out")
check "manifest: macos url" \
  "https://github.com/damrek/kindclip/releases/download/v2.0.0/kindclip_universal.app.tar.gz" \
  "$expected"
arm_url=$(jq -r '.platforms["darwin-aarch64"].url' <<<"$manifest_out")
check "manifest: darwin keys share the bundle" "$expected" "$arm_url"
arm_sig=$(jq -r '.platforms["darwin-aarch64"].signature' <<<"$manifest_out")
x64_sig=$(jq -r '.platforms["darwin-x86_64"].signature' <<<"$manifest_out")
check "manifest: darwin keys share the signature" "$x64_sig" "$arm_sig"

# 3. The AppImage bundle is never mistaken for the macOS one.
darwin_url=$(jq -r '.platforms["darwin-x86_64"].url' <<<"$manifest_out")
case "$darwin_url" in
  *AppImage*)
    check "manifest: AppImage stays on linux" "no AppImage in the macOS entry" "$darwin_url" ;;
  *) check "manifest: AppImage stays on linux" ok ok ;;
esac

# 4. A missing asset is a hard failure with no partial manifest.
jq 'del(.assets[] | select(.name | endswith(".AppImage.tar.gz")))' \
  "$tmp/assets.json" >"$tmp/no-linux.json"
run_manifest "$tmp/no-linux.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "missing asset: exit 1" 1 "$manifest_status"
check "missing asset: no stdout" "" "$manifest_out"

# 5. A missing signature is a hard failure too.
mkdir -p "$tmp/empty-sigs"
run_manifest "$tmp/assets.json" "$tmp/empty-sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "missing signature: exit 1" 1 "$manifest_status"
check "missing signature: no stdout" "" "$manifest_out"

# 6. Usage errors are distinct from missing data (exit 2).
set +e
bash "$script" >"$tmp/stdout" 2>"$tmp/stderr"
manifest_status=$?
set -e
check "usage: exit 2" 2 "$manifest_status"
check "usage: no stdout" "" "$(cat "$tmp/stdout")"

# 6b. Without a notes file the key is absent instead of empty, so the app shows
#     no "what's new" block rather than a blank one.
run_manifest "$tmp/assets.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "manifest: no notes key without a body" "null" "$(jq -r '.notes' <<<"$manifest_out")"

# 6c. An unreadable notes file is a usage error.
run_manifest "$tmp/assets.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z "$tmp/no-notes.md"
check "unreadable notes: exit 2" 2 "$manifest_status"

# 6d. Too many arguments is a usage error, not a silently ignored extra.
run_manifest "$tmp/assets.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z "$tmp/notes.md" extra
check "extra argument: exit 2" 2 "$manifest_status"

# 7. An unreadable asset list is a usage error.
run_manifest "$tmp/does-not-exist.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "unreadable assets: exit 2" 2 "$manifest_status"

# 8. A file that is not a release asset list is rejected, not parsed as empty.
printf '{"nope": true}\n' >"$tmp/not-assets.json"
run_manifest "$tmp/not-assets.json" "$tmp/sigs" 2.0.0 damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "non-asset json: exit 2" 2 "$manifest_status"

# 9. An empty argument is a usage error.
run_manifest "$tmp/assets.json" "$tmp/sigs" "" damrek/kindclip v2.0.0 2026-11-19T10:00:00Z
check "empty version: exit 2" 2 "$manifest_status"

printf '\n%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
