#!/usr/bin/env bash
# catalog-deploy.sh — ingest + publish source for catalog.lufs.audio.
#
# DEPLOY MODEL (GitHub Actions owns the build + publish):
#   run the ingest locally (it needs the NAS-mounted source + ffmpeg), commit the
#   generated content to `main`, and push. The GitHub Actions workflow
#   (.github/workflows/deploy.yml) then builds the static site and publishes the built
#   dist/ to the `hostinger` branch, which Hostinger's Git auto-deploy webhook pulls
#   into public_html.
#
#   This script does NOT build-and-push the hostinger branch itself: doing that here
#   AND in CI makes two publishers race for the same ref (one push gets rejected with
#   "cannot lock ref"). CI also builds from the clean repo, so its dist/ never picks up
#   stray local files. We still run a local build here, but only to VALIDATE that the
#   site compiles before pushing. See docs/implementation/09-ingest-and-deploy.md.
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

# --- 2) Validate the build (CI rebuilds + publishes; this is just a compile check) ---
echo "==> Building Astro site (validation only) ..."
pnpm build
[ -d dist ] || { echo "Error: build produced no dist/."; exit 1; }

# --- 3) Commit source to main (skip if nothing changed) ---
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "catalog: update $(date +'%Y-%m-%d %H:%M:%S')"
fi
echo "==> Pushing source to main ..."
git push origin main

# CI (.github/workflows/deploy.yml) takes it from here: build -> publish the
# '${HOSTINGER_BRANCH}' branch -> Hostinger auto-deploys it. We deliberately do NOT
# push the '${HOSTINGER_BRANCH}' branch from here (that would race the CI publisher).
echo "✓ Pushed main. GitHub Actions builds + publishes the '${HOSTINGER_BRANCH}' branch"
echo "  (watch the repo's Actions tab); Hostinger then auto-deploys it to catalog.lufs.audio."
