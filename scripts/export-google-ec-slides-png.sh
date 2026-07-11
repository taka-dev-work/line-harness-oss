#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/generated/google-io-ec-slides"
SRC_DIR="$OUT_DIR/png-source"

node "$ROOT_DIR/scripts/generate-google-ec-slides.mjs"

for svg in "$SRC_DIR"/slide-*.svg; do
  qlmanage -t -s 1920 -o "$SRC_DIR" "$svg" >/dev/null
  base="$(basename "$svg" .svg)"
  sips -c 1080 1920 "$SRC_DIR/$base.svg.png" --out "$OUT_DIR/$base.png" >/dev/null
done

echo "Exported PNG slides to $OUT_DIR"
