#!/bin/bash
# catalog-sync.sh — Sync catalog assets from workchain output to website
#
# Usage: ./catalog-sync.sh [--build]
#   --build    Optionally run build after syncing
#
# This script:
# 1. Runs the ingest script to copy assets to public/
# 2. Regenerates content files from source
# 3. Optionally builds the site
#
# Requirements:
#   - CATALOG_SOURCE_PATH must be set (in .env.local or environment)
#   - Node.js and pnpm must be installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load env file if exists
if [ -f .env.local ]; then
  echo "Loading .env.local..."
  set -a; source .env.local; set +a
fi

# Default CATALOG_SOURCE_PATH if not set
CATALOG_SOURCE_PATH="${CATALOG_SOURCE_PATH:-/Volumes/project/continuo/catalogs}"

# Add npm global bin to PATH
export PATH="$(npm root -g)/bin:$PATH"

echo "=== LUFS Catalog Sync ==="
echo "Source path: $CATALOG_SOURCE_PATH"
echo ""

# Check for required commands
for cmd in pnpm node; do
  if ! command -v $cmd &> /dev/null; then
    echo "Error: $cmd not found in PATH."
    exit 1
  fi
done

# Check if source directory exists
if [ ! -d "$CATALOG_SOURCE_PATH" ]; then
  echo "Error: CATALOG_SOURCE_PATH not found: $CATALOG_SOURCE_PATH"
  exit 1
fi

# Run ingest (the astro-catalog ingest; mode via STORAGE_MODE)
echo "Running catalog ingest..."
pnpm catalog:ingest

echo ""
echo "=== Sync complete ==="

# Check for --build flag
if [[ "${1:-}" == "--build" ]]; then
  echo ""
  echo "Building production site..."
  pnpm build
  echo ""
  echo "=== Build complete ==="
  echo "Output in dist/"
fi
