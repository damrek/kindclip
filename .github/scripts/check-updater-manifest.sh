#!/usr/bin/env bash
# Verify the updater manifest tauri-action published.
#
# The action merges each leg's platform entry into latest.json as the leg
# finishes, and two failures are invisible from the release page: a platform
# whose entry was lost to a concurrent write, and an entry left over from a
# previous attempt whose signature no longer matches the bundle that replaced
# it. Both make the app refuse the update without a word, so this script
# compares what the manifest promises against what the release actually holds.
#
# Usage: check-updater-manifest.sh <manifest-json> <assets-json> <sig-dir> <version>
#   manifest-json  the latest.json downloaded back from the release
#   assets-json    output of `gh release view <tag> --json assets`
#   sig-dir        directory holding the release's `<asset>.sig` files
#   version        the released version, without the leading `v`
#
# Exits 2 on a usage or input error, 1 when the manifest does not match the
# release, 0 when it does.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: check-updater-manifest.sh <manifest-json> <assets-json> <sig-dir> <version>" >&2
  exit 2
fi

manifest=$1
assets_json=$2
sig_dir=$3
version=$4

# The keys the updater looks for, in the order it resolves them. The plugin
# asks for `{os}-{arch}-{installer}` first and falls back to `{os}-{arch}`, so
# a missing installer key silently sends a .deb install to the AppImage.
required_keys=(
  linux-x86_64
  linux-x86_64-appimage
  linux-x86_64-deb
  linux-x86_64-rpm
  windows-x86_64
  darwin-x86_64
  darwin-aarch64
)

for value in "$version"; do
  if [ -z "$value" ]; then
    echo "check-updater-manifest: empty version" >&2
    exit 2
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "check-updater-manifest: jq is required" >&2
  exit 2
fi

for file in "$manifest" "$assets_json"; do
  if [ ! -r "$file" ]; then
    echo "check-updater-manifest: cannot read $file" >&2
    exit 2
  fi
done

if ! jq -e '.platforms | type == "object"' "$manifest" >/dev/null 2>&1; then
  echo "check-updater-manifest: $manifest is not an updater manifest" >&2
  exit 2
fi

failures=0
fail() {
  echo "::error::check-updater-manifest: $*" >&2
  failures=$((failures + 1))
}

released=$(jq -r '.version // ""' "$manifest")
if [ "$released" != "$version" ]; then
  fail "manifest says version '$released' but the release is $version"
fi

notes=$(jq -r '.notes // ""' "$manifest")
if [ -z "$notes" ]; then
  fail "manifest carries no notes; the update dialog would show nothing"
fi

asset_names=$(jq -r '.assets[]?.name' "$assets_json")

for key in "${required_keys[@]}"; do
  url=$(jq -r --arg k "$key" '.platforms[$k].url // ""' "$manifest")
  if [ -z "$url" ]; then
    fail "manifest has no '$key' entry"
    continue
  fi

  asset=${url##*/}
  if ! printf '%s\n' "$asset_names" | grep -qxF -- "$asset"; then
    fail "'$key' points at $asset, which the release does not carry"
    continue
  fi

  signature=$(jq -r --arg k "$key" '.platforms[$k].signature // ""' "$manifest")
  if [ -z "$signature" ]; then
    fail "'$key' has no signature"
    continue
  fi

  sig_file="$sig_dir/$asset.sig"
  if [ ! -f "$sig_file" ]; then
    fail "'$key' points at $asset but the release has no $asset.sig"
    continue
  fi

  published=$(tr -d '\r\n' <"$sig_file")
  if [ "$signature" != "$published" ]; then
    fail "'$key' signs $asset differently from the published signature"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "check-updater-manifest: $failures problem(s) found" >&2
  exit 1
fi

echo "check-updater-manifest: $version is complete and every signature matches"
