#!/usr/bin/env bash
# Mirror the built web viewer (repo-root dist/) into ios/WebDist/ so it can be
# bundled into the app for the offline embedded viewer.
#
# Run after `npm run build` and before `xcodegen generate` / an Xcode build:
#   npm run build && ios/scripts/copy-webdist.sh && (cd ios && xcodegen generate)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"   # ios/
dist="$here/../dist"
dest="$here/WebDist"

if [ ! -d "$dist" ]; then
  echo "error: $dist not found — run 'npm run build' at the repo root first." >&2
  exit 1
fi

mkdir -p "$dest"
rsync -a --delete \
  --exclude '.DS_Store' --exclude '_headers' --exclude '_redirects' --exclude '*.gpx' \
  "$dist/" "$dest/"

echo "Copied $(du -sh "$dest" | cut -f1) of web assets → $dest"
