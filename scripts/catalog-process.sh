#!/usr/bin/env bash
# catalog-process.sh — run the lufs-workchain astro-catalog chain on audio file(s)
# and leave the output as {album}/{track-name}_astro-catalog/ , exactly as the ingest
# expects. This is the "new audio -> processed -> ready to ingest" step.
#
# Robust + defensive by design:
#   • Writes directly to the correctly-named output dir via `-o` (no fragile rename).
#   • Passes `--report` so every track gets its proof-of-work HTML (the ingest links it).
#   • Skips a track only when its existing output is genuinely COMPLETE
#     (context.json status == "completed" AND every step completed); a half-written
#     or failed dir is wiped and reprocessed instead of silently kept.
#   • Handles spaces / apostrophes / unicode in filenames (NUL-delimited iteration).
#
# Usage:
#   ./scripts/catalog-process.sh <audio-file> [<audio-file> ...]
#   ./scripts/catalog-process.sh --album <album-dir>        # every audio file in one album root
#   ./scripts/catalog-process.sh --all   [<catalogs-root>]  # every album under the catalogs root
#                                                            #   (default: $CATALOG_SOURCE_PATH)
# Flags:
#   --force      reprocess even tracks whose output is already complete
#   --report/--no-report   include / skip the HTML report (default: include)
#   --verify-only          don't process; just print the completed/incomplete tally
#
# Requires: the lufs-workchain CLI on PATH (`cd cli && npm install && npm link` in the
# workchain repo), ffmpeg/ffprobe, and the workchain's Python deps (`uv sync`).
# Override the command with WORKCHAIN_CMD, the chain with CHAIN.

set -euo pipefail

WORKCHAIN_CMD="${WORKCHAIN_CMD:-lufs-workchain}"
CHAIN="${CHAIN:-astro-catalog}"
AUDIO_EXTS=(wav aif aiff mp3 m4a flac ogg)

FORCE=0
REPORT=1
VERIFY_ONLY=0
MODE=""
declare -a TARGETS=()

# ---- arg parse ----
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --report) REPORT=1; shift ;;
    --no-report) REPORT=0; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --all) MODE="all"; shift; [ $# -gt 0 ] && [ "${1#-}" = "$1" ] && { TARGETS+=("$1"); shift; } ;;
    --album) MODE="album"; shift; [ $# -ge 1 ] || { echo "Usage: catalog-process.sh --album <album-dir>" >&2; exit 2; }; TARGETS+=("$1"); shift ;;
    -*) echo "Unknown flag: $1" >&2; exit 2 ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done

if [ -z "$MODE" ] && [ "${#TARGETS[@]}" -gt 0 ]; then MODE="files"; fi
if [ -z "$MODE" ]; then MODE="all"; fi

# Stage NUL-delimited file lists on disk and read from real files rather than
# `< <(...)` process substitution, which not every environment exposes (/dev/fd).
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# is_complete <astro-catalog-dir>  -> 0 if context.json status==completed and all steps completed
is_complete() {
  local ctx="$1/context.json"
  [ -f "$ctx" ] || return 1
  CTX="$ctx" python3 - <<'PY'
import json, os, sys
try:
    d = json.load(open(os.environ["CTX"]))
except Exception:
    sys.exit(1)
steps = d.get("steps") or {}
bad = [k for k, v in steps.items() if isinstance(v, dict) and v.get("status") not in ("completed",)]
sys.exit(0 if d.get("status") == "completed" and not bad else 1)
PY
}

ok_count=0; fail_count=0; skip_count=0

process_file() {
  local f="$1" dir base name out
  [ -f "$f" ] || { echo "  ⚠ not a file: $f"; return 0; }
  dir="$(cd "$(dirname "$f")" && pwd)"
  base="$(basename "$f")"
  name="${base%.*}"
  out="$dir/${name}_astro-catalog"

  if [ "$VERIFY_ONLY" = 1 ]; then
    if is_complete "$out"; then echo "  ✓ complete: ${name}"; ok_count=$((ok_count+1));
    else echo "  ✗ INCOMPLETE/MISSING: ${name}"; fail_count=$((fail_count+1)); fi
    return 0
  fi

  if [ "$FORCE" != 1 ] && is_complete "$out"; then
    echo "skip (already complete): ${name}_astro-catalog"; skip_count=$((skip_count+1)); return 0
  fi

  [ -d "$out" ] && { echo "  (cleaning stale output: ${name}_astro-catalog)"; rm -rf "$out"; }

  echo "==> ${CHAIN}: ${base}"
  local args=(run "$CHAIN" "$f" -o "$out")
  [ "$REPORT" = 1 ] && args+=(--report)
  if ! "$WORKCHAIN_CMD" "${args[@]}"; then
    echo "  ✗ workchain failed for: $f" >&2; fail_count=$((fail_count+1)); return 0
  fi

  if is_complete "$out"; then
    echo "  ✓ ${name}_astro-catalog"; ok_count=$((ok_count+1))
  else
    echo "  ⚠ produced output but it isn't 'completed' (check $out/context.json)" >&2; fail_count=$((fail_count+1))
  fi
}

# NUL-delimited list of audio files (handles spaces/apostrophes/unicode).
find_audio() { # $1 = dir, $2 = maxdepth
  find "$1" -maxdepth "$2" -type f \
    \( -iname '*.wav' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.mp3' \
       -o -iname '*.m4a' -o -iname '*.flac' -o -iname '*.ogg' \) -print0
}

command -v "$WORKCHAIN_CMD" >/dev/null 2>&1 || [ "$VERIFY_ONLY" = 1 ] || {
  echo "Error: '$WORKCHAIN_CMD' not found on PATH. Install the lufs-workchain CLI (cd cli && npm install && npm link), or set WORKCHAIN_CMD." >&2
  exit 1
}

case "$MODE" in
  files)
    for f in "${TARGETS[@]}"; do process_file "$f"; done
    ;;
  album)
    album="${TARGETS[0]}"
    [ -d "$album" ] || { echo "Error: not a dir: $album" >&2; exit 2; }
    find_audio "$album" 1 > "$TMPD/files"
    while IFS= read -r -d '' f; do process_file "$f"; done < "$TMPD/files"
    ;;
  all)
    root="${TARGETS[0]:-${CATALOG_SOURCE_PATH:-/Volumes/project/continuo/catalogs}}"
    [ -d "$root" ] || { echo "Error: catalogs root not found (is the NAS mounted?): $root" >&2; exit 1; }
    echo "Scanning albums under: $root"
    # each top-level dir is an album; process audio files in the album ROOT (depth 1)
    find "$root" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z > "$TMPD/albums"
    while IFS= read -r -d '' album; do
      bn="$(basename "$album")"
      case "$bn" in _utilities|.*) continue ;; esac
      echo ""; echo "album: $bn"
      find_audio "$album" 1 > "$TMPD/album_files"
      while IFS= read -r -d '' f; do process_file "$f"; done < "$TMPD/album_files"
    done < "$TMPD/albums"
    ;;
esac

echo ""
if [ "$VERIFY_ONLY" = 1 ]; then
  echo "verify: complete=$ok_count | incomplete/missing=$fail_count"
  [ "$fail_count" = 0 ]
else
  echo "done: ok=$ok_count | failed=$fail_count | skipped=$skip_count"
  echo "Next: pnpm catalog:ingest   (or ./catalog-deploy.sh --ingest to ingest + build + deploy)"
  [ "$fail_count" = 0 ]
fi
