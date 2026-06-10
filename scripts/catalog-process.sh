#!/usr/bin/env bash
# catalog-process.sh — run the lufs-workchain astro-catalog chain on audio file(s)
# and leave the output as {album}/{track-name}_astro-catalog/ , ready for the ingest.
#
# This is the "new audio -> processed -> ready to ingest" step. After it, run
# `pnpm catalog:ingest` (or `./catalog-deploy.sh --ingest`).
#
# Usage:
#   ./scripts/catalog-process.sh <audio-file> [<audio-file> ...]
#   ./scripts/catalog-process.sh --album <album-dir>   # every audio file in the album root
#                                                        that doesn't already have an _astro-catalog dir
#
# Requires: the lufs-workchain CLI on PATH (the Node CLI: `cd cli && npm install && npm link`
# in the workchain repo), ffmpeg/ffprobe, and the workchain's Python deps for
# artwork/canvas (`uv sync` in the workchain repo). Override the command with
# WORKCHAIN_CMD, the chain with CHAIN.

set -euo pipefail

WORKCHAIN_CMD="${WORKCHAIN_CMD:-lufs-workchain}"
CHAIN="${CHAIN:-astro-catalog}"

command -v "$WORKCHAIN_CMD" >/dev/null 2>&1 || {
  echo "Error: '$WORKCHAIN_CMD' not found on PATH. Install the lufs-workchain CLI (cd cli && npm install && npm link), or set WORKCHAIN_CMD." >&2
  exit 1
}

process_file() {
  local f="$1" dir base name out
  [ -f "$f" ] || { echo "  ⚠ not a file: $f"; return 0; }
  dir="$(cd "$(dirname "$f")" && pwd)"
  base="$(basename "$f")"
  name="${base%.*}"
  out="$dir/${name}_astro-catalog"

  if [ -d "$out" ]; then echo "skip (already processed): ${name}_astro-catalog"; return 0; fi

  echo "==> ${CHAIN}: ${base}"
  "$WORKCHAIN_CMD" run "$CHAIN" "$f" || { echo "  ✗ workchain failed for: $f"; return 1; }

  # The chain writes to {input_dir}/astro-catalog by default; normalize the name so an
  # album root can hold one output dir per track (see docs/implementation/09 §1).
  if [ -d "$dir/astro-catalog" ]; then
    mv "$dir/astro-catalog" "$out"
    echo "  ✓ ${name}_astro-catalog"
  elif [ -d "$out" ]; then
    echo "  ✓ ${name}_astro-catalog (workchain honored -o)"
  else
    echo "  ⚠ expected output not found (looked for $dir/astro-catalog). Check the workchain output location." >&2
    return 1
  fi
}

if [ "${1:-}" = "--album" ]; then
  [ $# -ge 2 ] || { echo "Usage: catalog-process.sh --album <album-dir>"; exit 2; }
  album="$2"
  [ -d "$album" ] || { echo "Error: not a dir: $album" >&2; exit 2; }
  shopt -s nullglob
  found=0
  for f in "$album"/*.wav "$album"/*.aif "$album"/*.aiff "$album"/*.mp3 "$album"/*.m4a "$album"/*.flac; do
    [ -e "$f" ] || continue
    found=1
    process_file "$f"
  done
  [ "$found" = 1 ] || echo "No audio files found in $album"
else
  [ $# -ge 1 ] || { echo "Usage: catalog-process.sh <audio-file>... | --album <dir>" >&2; exit 2; }
  for f in "$@"; do process_file "$f"; done
fi

echo ""
echo "Done. Next: pnpm catalog:ingest   (or ./catalog-deploy.sh --ingest to ingest + build + deploy)"
