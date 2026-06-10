#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep -m1 '"version"' "$ROOT/extension/manifest.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
OUT="$ROOT/dist/raceplugin-v${VERSION}.zip"

mkdir -p "$ROOT/dist"
rm -f "$OUT"

(
  cd "$ROOT/extension"
  zip -r "$OUT" . -x "*.DS_Store"
)

echo "Built: $OUT"
