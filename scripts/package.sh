#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep -m1 '"version"' "$ROOT/extension/manifest.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
DATE="$(date +%Y%m%d)"
OUT="$ROOT/dist/Logic_投注助手_v${VERSION}_${DATE}.zip"

mkdir -p "$ROOT/dist"
rm -f "$OUT"

(
  cd "$ROOT/extension"
  zip -r "$OUT" . -x "*.DS_Store"
)

echo "Built: $OUT"
