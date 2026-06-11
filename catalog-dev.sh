#!/bin/bash
# catalog-dev.sh — Local development wrapper for LUFS Audio Catalog
#
# Usage: ./catalog-dev.sh [--ingest]
#   --ingest  Run catalog ingest before starting dev server
#
# This script:
# 1. Loads .env.local if it exists
# 2. Runs catalog:ingest (the astro-catalog ingest) if --ingest flag
# 3. Starts the Astro dev server
#
# Make executable: chmod +x catalog-dev.sh

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

# Check for required commands
for cmd in pnpm node; do
  if ! command -v $cmd &> /dev/null; then
    echo "Error: $cmd not found in PATH."
    exit 1
  fi
done

# Parse arguments
INGEST_AFTER=false
if [[ "${1:-}" == "--ingest" ]]; then
  INGEST_AFTER=true
fi

# Step 1: Run ingest if requested
if [[ "$INGEST_AFTER" == "true" ]]; then
  echo ""
  echo "Running catalog ingest from $CATALOG_SOURCE_PATH..."
  pnpm catalog:ingest || {
    echo "Error: Catalog ingest failed."
    exit 1
  }
fi

# Step 2: Start dev server
echo ""
echo "Starting Astro dev server on http://0.0.0.0:4321..."
exec pnpm dev --host 0.0.0.0
