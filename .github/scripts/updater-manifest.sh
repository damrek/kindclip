#!/usr/bin/env bash
# Compose the updater manifest (`latest.json`) for a release that is already
# published.
#
# The three build legs run in parallel, so each one uploading its own
# latest.json would overwrite the others and leave a manifest with a single
# platform (tauri-action#1270). The release therefore builds with
# `includeUpdaterJson: false` and one job runs this script afterwards.
#
# Usage: updater-manifest.sh <assets-json> <sig-dir> <version> <repo> <tag> <pub-date>
#   assets-json  output of `gh release view <tag> --json assets`
#   sig-dir      directory holding the downloaded `<asset>.sig` files
#   version      the released version, without the leading `v`
#   repo         owner/name, e.g. damrek/kindclip
#   tag          the release tag, e.g. v2.1.0
#   pub-date     RFC 3339 timestamp the manifest should carry
#
# Exits 2 on a usage or input error, 1 when an expected asset or signature is
# missing, 0 with the manifest on stdout.
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "usage: updater-manifest.sh <assets-json> <sig-dir> <version> <repo> <tag> <pub-date>" >&2
  exit 2
fi

assets_json=$1
sig_dir=$2
version=$3
repo=$4
tag=$5
pub_date=$6

for value in "$version" "$repo" "$tag" "$pub_date"; do
  if [ -z "$value" ]; then
    echo "updater-manifest: empty argument" >&2
    exit 2
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "updater-manifest: jq is required" >&2
  exit 2
fi

if [ ! -r "$assets_json" ]; then
  echo "updater-manifest: cannot read $assets_json" >&2
  exit 2
fi

asset_names=$(jq -r '.assets[]?.name' "$assets_json" 2>/dev/null) || {
  echo "updater-manifest: $assets_json is not a release asset list" >&2
  exit 2
}

# A missing or non-array `assets` is a malformed input, not an empty release:
# the release job always passes `gh release view --json assets`.
if ! jq -e '.assets | type == "array"' "$assets_json" >/dev/null 2>&1; then
  echo "updater-manifest: $assets_json is not a release asset list" >&2
  exit 2
fi

fail() {
  echo "updater-manifest: $*" >&2
  exit 1
}

# The suffixes are distinct on purpose: an AppImage bundle is
# `..._amd64.AppImage.tar.gz` and the macOS one is `..._universal.app.tar.gz`,
# so a case-sensitive match never confuses the two.
find_asset() { # suffix
  local match
  match=$(printf '%s\n' "$asset_names" | grep -F -- "$1" | head -n 1)
  [ -n "$match" ] || fail "no release asset ends in $1"
  printf '%s' "$match"
}

signature_of() { # asset
  local file="$sig_dir/$1.sig"
  [ -f "$file" ] || fail "missing signature for $1 (looked for $file)"
  # Minisign emits one line; strip any trailing CR so a Windows checkout of
  # the artifact cannot leak one into the JSON string.
  tr -d '\r\n' <"$file"
}

url_of() { # asset
  printf 'https://github.com/%s/releases/download/%s/%s' "$repo" "$tag" "$1"
}

linux_asset=$(find_asset ".AppImage.tar.gz")
windows_asset=$(find_asset "-setup.exe")
macos_asset=$(find_asset ".app.tar.gz")

linux_sig=$(signature_of "$linux_asset")
windows_sig=$(signature_of "$windows_asset")
macos_sig=$(signature_of "$macos_asset")

# A universal macOS build runs as arm64 on Apple Silicon and as x86_64 on
# Intel, and the updater asks for `darwin-<arch>` unless a custom target is
# set. Publishing the same universal bundle under both keys keeps the manifest
# in the documented vocabulary and updates either Mac.
jq -n \
  --arg version "$version" \
  --arg pub_date "$pub_date" \
  --arg linux_url "$(url_of "$linux_asset")" \
  --arg linux_sig "$linux_sig" \
  --arg windows_url "$(url_of "$windows_asset")" \
  --arg windows_sig "$windows_sig" \
  --arg macos_url "$(url_of "$macos_asset")" \
  --arg macos_sig "$macos_sig" \
  '{
    version: $version,
    pub_date: $pub_date,
    platforms: {
      "linux-x86_64": { signature: $linux_sig, url: $linux_url },
      "windows-x86_64": { signature: $windows_sig, url: $windows_url },
      "darwin-x86_64": { signature: $macos_sig, url: $macos_url },
      "darwin-aarch64": { signature: $macos_sig, url: $macos_url }
    }
  }'
