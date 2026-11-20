#!/usr/bin/env bash
# Tests for check-updater-manifest.sh. Dependency-free apart from jq, which the
# release job already requires: run with
#   bash .github/scripts/check-updater-manifest.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/check-updater-manifest.sh"
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

run_check() {
  set +e
  out=$(bash "$script" "$@" 2>"$tmp/stderr")
  status=$?
  set -e
}

mkdir -p "$tmp/sigs"

cat >"$tmp/assets.json" <<'EOF'
{
  "assets": [
    { "name": "kindclip_2.0.0_amd64.AppImage" },
    { "name": "kindclip_2.0.0_amd64.AppImage.sig" },
    { "name": "kindclip_2.0.0_amd64.deb" },
    { "name": "kindclip_2.0.0_amd64.deb.sig" },
    { "name": "kindclip-2.0.0-1.x86_64.rpm" },
    { "name": "kindclip-2.0.0-1.x86_64.rpm.sig" },
    { "name": "kindclip_2.0.0_x64-setup.exe" },
    { "name": "kindclip_2.0.0_x64-setup.exe.sig" },
    { "name": "kindclip_universal.app.tar.gz" },
    { "name": "kindclip_universal.app.tar.gz.sig" }
  ]
}
EOF

# What tauri-action really writes for a healthy release.
cat >"$tmp/manifest.json" <<'EOF'
{
  "version": "2.0.0",
  "notes": "### Added\n\n- Something.",
  "pub_date": "2026-11-19T10:00:00Z",
  "platforms": {
    "linux-x86_64": { "signature": "appimage-sig", "url": "https://example/kindclip_2.0.0_amd64.AppImage" },
    "linux-x86_64-appimage": { "signature": "appimage-sig", "url": "https://example/kindclip_2.0.0_amd64.AppImage" },
    "linux-x86_64-deb": { "signature": "deb-sig", "url": "https://example/kindclip_2.0.0_amd64.deb" },
    "linux-x86_64-rpm": { "signature": "rpm-sig", "url": "https://example/kindclip-2.0.0-1.x86_64.rpm" },
    "windows-x86_64": { "signature": "exe-sig", "url": "https://example/kindclip_2.0.0_x64-setup.exe" },
    "darwin-x86_64": { "signature": "mac-sig", "url": "https://example/kindclip_universal.app.tar.gz" },
    "darwin-aarch64": { "signature": "mac-sig", "url": "https://example/kindclip_universal.app.tar.gz" }
  }
}
EOF

printf 'appimage-sig' >"$tmp/sigs/kindclip_2.0.0_amd64.AppImage.sig"
printf 'deb-sig' >"$tmp/sigs/kindclip_2.0.0_amd64.deb.sig"
printf 'rpm-sig' >"$tmp/sigs/kindclip-2.0.0-1.x86_64.rpm.sig"
printf 'exe-sig' >"$tmp/sigs/kindclip_2.0.0_x64-setup.exe.sig"
printf 'mac-sig' >"$tmp/sigs/kindclip_universal.app.tar.gz.sig"

# 1. A healthy release passes.
run_check "$tmp/manifest.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "healthy: exit 0" 0 "$status"

# 2. A signature that no longer matches the published bundle fails: this is the
#    2.1.0 macOS failure, where the manifest kept the previous attempt's entry.
jq '.platforms["darwin-x86_64"].signature = "stale-sig"' \
  "$tmp/manifest.json" >"$tmp/stale.json"
run_check "$tmp/stale.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "stale signature: exit 1" 1 "$status"
case "$(cat "$tmp/stderr")" in
  *"signs kindclip_universal.app.tar.gz differently"*) check "stale signature: names the key" ok ok ;;
  *) check "stale signature: names the key" "message about darwin" "$(cat "$tmp/stderr")" ;;
esac

# 3. A lost update that drops the deb/rpm entries fails: without them a .deb
#    install falls back to the AppImage and the install breaks.
jq 'del(.platforms["linux-x86_64-deb"])' "$tmp/manifest.json" >"$tmp/no-deb.json"
run_check "$tmp/no-deb.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "missing deb entry: exit 1" 1 "$status"
case "$(cat "$tmp/stderr")" in
  *"no 'linux-x86_64-deb' entry"*) check "missing deb entry: names it" ok ok ;;
  *) check "missing deb entry: names it" "message about the deb key" "$(cat "$tmp/stderr")" ;;
esac

# 4. A URL pointing at an asset the release does not hold fails.
jq '.platforms["windows-x86_64"].url = "https://example/gone.exe"' \
  "$tmp/manifest.json" >"$tmp/gone.json"
run_check "$tmp/gone.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "missing asset: exit 1" 1 "$status"

# 5. An entry with no signature fails.
jq '.platforms["linux-x86_64"].signature = ""' "$tmp/manifest.json" >"$tmp/unsigned.json"
run_check "$tmp/unsigned.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "empty signature: exit 1" 1 "$status"

# 6. A manifest for another version fails.
run_check "$tmp/manifest.json" "$tmp/assets.json" "$tmp/sigs" 2.0.1
check "version mismatch: exit 1" 1 "$status"

# 7. A manifest with no notes fails: the dialog would show nothing.
jq 'del(.notes)' "$tmp/manifest.json" >"$tmp/no-notes.json"
run_check "$tmp/no-notes.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "no notes: exit 1" 1 "$status"

# 8. A `.sig` missing from the release fails even when the manifest copied it.
mkdir -p "$tmp/empty-sigs"
run_check "$tmp/manifest.json" "$tmp/assets.json" "$tmp/empty-sigs" 2.0.0
check "missing sig asset: exit 1" 1 "$status"

# 9. Usage and input errors are exit 2, distinct from a failed check.
set +e
bash "$script" >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
check "usage: exit 2" 2 "$status"
check "usage: no stdout" "" "$(cat "$tmp/stdout")"

run_check "$tmp/manifest.json" "$tmp/nope.json" "$tmp/sigs" 2.0.0
check "unreadable assets: exit 2" 2 "$status"

printf '{"platforms": "nope"}\n' >"$tmp/not-manifest.json"
run_check "$tmp/not-manifest.json" "$tmp/assets.json" "$tmp/sigs" 2.0.0
check "not a manifest: exit 2" 2 "$status"

printf '\n%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
