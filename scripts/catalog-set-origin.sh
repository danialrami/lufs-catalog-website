#!/usr/bin/env bash
# catalog-set-origin.sh — switch the catalog's PRIMARY storage origin.
#
# Flips STORAGE_PRIMARY in the chosen env file between Cloudflare R2 and the
# NAS rustfs instance. This is the "switch production to local rustfs" control.
# It only edits the env file; rebuild/redeploy for the change to take effect.
#
# Usage: ./scripts/catalog-set-origin.sh <r2|rustfs> [--env <file>] [--force]
#   --force   switch to rustfs even if RUSTFS_ENDPOINT isn't configured yet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ORIGIN="${1:-}"; [[ $# -gt 0 ]] && shift || true
ENV_FILE=""; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2;;
    --force) FORCE=1; shift;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ "$ORIGIN" != "r2" && "$ORIGIN" != "rustfs" ]]; then
  echo "Usage: catalog-set-origin.sh <r2|rustfs> [--env <file>] [--force]" >&2
  exit 2
fi

if [[ -z "$ENV_FILE" ]]; then
  for f in "$ROOT/.env.production" "$ROOT/.env.local"; do
    [[ -f "$f" ]] && { ENV_FILE="$f"; break; }
  done
fi
[[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || {
  echo "No env file found. Copy .env.production.example -> .env.production first." >&2
  exit 1
}

# Guard: switching to rustfs only makes sense once the endpoint exists.
if [[ "$ORIGIN" == "rustfs" && "$FORCE" -ne 1 ]]; then
  if ! grep -Eq '^[[:space:]]*RUSTFS_ENDPOINT=[^[:space:]]+' "$ENV_FILE"; then
    echo "WARNING: RUSTFS_ENDPOINT is not set/active in ${ENV_FILE##*/}." >&2
    echo "  The NAS rustfs endpoint may not be stood up yet." >&2
    echo "  Re-run with --force to switch anyway." >&2
    exit 3
  fi
fi

if grep -Eq '^[[:space:]]*STORAGE_PRIMARY=' "$ENV_FILE"; then
  tmp="$(mktemp)"
  sed -E "s|^([[:space:]]*)STORAGE_PRIMARY=.*|\1STORAGE_PRIMARY=${ORIGIN}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
else
  printf '\nSTORAGE_PRIMARY=%s\n' "$ORIGIN" >> "$ENV_FILE"
fi

echo "OK: STORAGE_PRIMARY=${ORIGIN} in ${ENV_FILE##*/}"
echo "Next: rebuild/redeploy for it to take effect (e.g. ./catalog-deploy.sh)."
