#!/usr/bin/env bash
# catalog-deploy.sh — build + deploy catalog.lufs.audio to Hostinger.
#
# DEPLOY MODEL (no GitHub Actions CI):
#   build the static site locally -> commit source to main -> publish the BUILT
#   dist/ to the `hostinger` branch. Hostinger's Git auto-deploy webhook watches
#   that branch and pulls it into public_html. This mirrors the Hugo blog flow.
#
#   Why local build: Hostinger static hosting does not run `astro build`, so the
#   deployed branch must already contain built output. The ingest must run locally
#   anyway (it needs the NAS-mounted source + ffmpeg), so building locally too keeps
#   everything in one place. See docs/implementation/09-ingest-and-deploy.md.
#
# Usage: ./catalog-deploy.sh [--ingest]
#   --ingest   run `pnpm catalog:ingest` first (transcode + assets + content .md)
#
# Requires: git, node, pnpm, ffmpeg (for --ingest). Reads .env.production (or .env.local).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Load env (prefer production) ---
# Parse KEY=VALUE pairs WITHOUT shell evaluation, so placeholder/URL values that
# contain shell metacharacters (e.g. `https://pub-<hash>.r2.dev`) can't trigger a
# redirection or command substitution and abort the deploy. Strips comments + quotes.
load_env() {
  local f="$1" line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"; val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"; key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ "$val" =~ ^(.*[^[:space:]])[[:space:]]+#.*$ ]] && val="${BASH_REMATCH[1]}"   # strip inline comment
    val="${val#"${val%%[![:space:]]*}"}"; val="${val%"${val##*[![:space:]]}"}"      # trim
    [[ ${#val} -ge 2 && "$val" == \"*\" ]] && val="${val:1:${#val}-2}"              # strip "quotes"
    [[ ${#val} -ge 2 && "$val" == \'*\' ]] && val="${val:1:${#val}-2}"              # strip 'quotes'
    export "$key=$val"
  done < "$f"
}
for f in .env.production .env.local .env; do
  if [ -f "$f" ]; then echo "Loading $f"; load_env "$f"; break; fi
done

HOSTINGER_BRANCH="${HOSTINGER_BRANCH:-hostinger}"

for cmd in git node pnpm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: '$cmd' not found in PATH."; exit 1; }
done

# --- 1) Optional ingest (transcode + assets + content) ---
if [[ "${1:-}" == "--ingest" ]]; then
  if [ ! -d "${CATALOG_SOURCE_PATH:-/Volumes/project/continuo/catalogs}" ]; then
    echo "Error: CATALOG_SOURCE_PATH not found (is the NAS mounted?): ${CATALOG_SOURCE_PATH:-/Volumes/project/continuo/catalogs}"
    exit 1
  fi
  echo "==> Ingesting from ${CATALOG_SOURCE_PATH:-/Volumes/project/continuo/catalogs} ..."
  pnpm catalog:ingest
fi

# --- 2) Build ---
echo "==> Building Astro site ..."
pnpm build
[ -d dist ] || { echo "Error: build produced no dist/."; exit 1; }

# --- 3) Commit source to main (skip if nothing changed) ---
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "catalog: update $(date +'%Y-%m-%d %H:%M:%S')"
fi
echo "==> Pushing source to main ..."
git push origin main

# --- 4) Publish built dist/ to the hostinger branch ---
# Use a throwaway repo so dist/ never has to be committed to main.
echo "==> Publishing dist/ to '${HOSTINGER_BRANCH}' (Hostinger webhook auto-deploys it) ..."
REMOTE_URL="$(git config --get remote.origin.url)"
DEPLOY_TMP="$(mktemp -d)"
cp -R dist/. "$DEPLOY_TMP"/
(
  cd "$DEPLOY_TMP"
  git init -q
  git checkout -q -b "$HOSTINGER_BRANCH"
  git add -A
  git commit -qm "deploy $(date +'%Y-%m-%d %H:%M:%S')"
  git push -f "$REMOTE_URL" "$HOSTINGER_BRANCH"
)
rm -rf "$DEPLOY_TMP"

echo "✓ Done. Hostinger auto-deploys '${HOSTINGER_BRANCH}' to catalog.lufs.audio."
