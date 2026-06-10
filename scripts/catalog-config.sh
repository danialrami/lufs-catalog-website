#!/usr/bin/env bash
# catalog-config.sh — print the EFFECTIVE LUFS catalog storage/ingest config.
#
# Read-only. Masks secrets. Reads the first env file found, or pass --env <file>.
# Used by the catalog-operator opencode agent to answer "what's the current config?".
#
# Usage: ./scripts/catalog-config.sh [--env <file>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2;;
    -h|--help) echo "Usage: catalog-config.sh [--env <file>]"; exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  for f in "$ROOT/.env.production" "$ROOT/.env.local" "$ROOT/.env"; do
    [[ -f "$f" ]] && { ENV_FILE="$f"; break; }
  done
fi

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "No env file found (looked for .env.production, .env.local, .env)." >&2
  echo "Copy .env.production.example -> .env.production and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

val(){ printf '%s' "${!1:-<unset>}"; }
mask(){ local v="${!1:-}"; if [[ -z "$v" ]]; then printf '<unset>'; else printf '****%s' "${v: -4}"; fi; }

echo "== LUFS Catalog config (${ENV_FILE##*/}) =="
echo "Storage mode       : $(val STORAGE_MODE)        # local | remote"
echo "Primary origin     : $(val STORAGE_PRIMARY)     # r2 | rustfs"
echo "Mirror (dual-write): $(val STORAGE_MIRROR)      # none | r2 | rustfs"
echo "Stream fallback    : $(val STREAM_FALLBACK_ENABLED)"
echo "Organize by        : $(val CATALOG_ORGANIZE)    # project | year | flat"
echo "Show drafts        : $(val SHOW_DRAFTS)"
echo "Source path        : $(val CATALOG_SOURCE_PATH)"
echo "-- Cloudflare R2 --------------------------------------------"
echo "Bucket             : $(val R2_BUCKET_NAME)"
echo "Endpoint           : $(val R2_ENDPOINT)"
echo "Public base URL    : $(val PUBLIC_R2_BASE_URL)"
echo "Stream worker URL  : $(val PUBLIC_R2_STREAM_URL)"
echo "Access key id      : $(mask R2_ACCESS_KEY_ID)"
echo "Secret access key  : $(mask R2_SECRET_ACCESS_KEY)"
echo "-- NAS rustfs (fallback / alternative origin) ---------------"
echo "Bucket             : $(val RUSTFS_BUCKET_NAME)"
echo "Endpoint           : $(val RUSTFS_ENDPOINT)"
echo "Public base URL    : $(val PUBLIC_RUSTFS_BASE_URL)"
echo "Stream worker URL  : $(val PUBLIC_RUSTFS_STREAM_URL)"
echo "Access key id      : $(mask RUSTFS_ACCESS_KEY_ID)"
echo "-------------------------------------------------------------"

prim="$(val STORAGE_PRIMARY)"
mode="$(val STORAGE_MODE)"
if [[ "$mode" == "local" ]]; then
  echo "ACTIVE: serving audio from local public/ (STORAGE_MODE=local)"
elif [[ "$prim" == "rustfs" ]]; then
  echo "ACTIVE: serving from NAS rustfs -> $(val PUBLIC_RUSTFS_BASE_URL)"
elif [[ "$prim" == "r2" ]]; then
  echo "ACTIVE: serving from Cloudflare R2 -> $(val PUBLIC_R2_BASE_URL)"
else
  echo "ACTIVE: unknown (STORAGE_PRIMARY=$prim)"
fi
