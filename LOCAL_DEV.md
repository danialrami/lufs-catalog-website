# Local-Only Development Setup

This document describes how to set up and use the local-only development environment for the LUFS Audio Catalog.

## Quick Start

1. **Copy environment template**:
   ```bash
   cp .env.local.example .env.local
   ```

2. **Ensure your workchain catalogs are mounted** at `/Volumes/project/continuo/catalogs` (or set `CATALOG_SOURCE_PATH` in `.env.local`)

3. **Run the dev server with ingest**:
   ```bash
   ./catalog-dev.sh --ingest
   ```
   
   Or manually:
   ```bash
   pnpm catalog:ingest:local
   pnpm dev
   ```

4. **Visit** `http://localhost:4321` in your browser

## Architecture Overview

### Local Development Flow

```
Workchain Output (e.g., /Volumes/project/continuo/catalogs/)
         │
         ▼
  catalog-ingest-local.mjs
         │
         ├─ Copies to public/audio/
         ├─ Copies to public/reports/
         ├─ Copies to public/covers/
         └─ Updates src/content/releases/*.md
         │
         ▼
    Astro dev/build (serves from dist/)
```

### File Locations

- **Audio files**: `public/audio/[collectionId]/[trackNumber]/[filename].mp3`
- **Reports**: `public/reports/[collectionId]/[trackNumber]/final_report.html`
- **Covers**: `public/covers/[collectionId]/[trackNumber]/*.png`
- **Release metadata**: `src/content/releases/[slug].md`

### Content Model

Tracks have these URL fields:

```yaml
tracks:
  - audioPath: "/audio/[collectionId]/[trackNumber]/[filename].mp3"
    renderStatsPath: "/reports/[collectionId]/[trackNumber]/render_stats.html"
    finalReport: "/reports/[collectionId]/[trackNumber]/final_report.html"
```

These are **local paths** that work with Astro's static server.

## Using the Player

The persistent bottom player uses Howler.js in HTML5 mode with localStorage state synchronization:

1. Click any play button to start playback
2. Player persists across page navigation (via Astro View Transitions + localStorage)
3. Use the progress bar to seek
4. Volume controls adjust playback
5. Position, volume, and play state are saved to localStorage every 500ms, allowing seamless resume even after full page reloads

## Development Commands

### Start Dev Server (no ingest)
```bash
pnpm dev
```
Serves from `http://localhost:4321`

### Build Production
```bash
pnpm build
```
Generates static site in `dist/`

### Preview Production Build
```bash
pnpm preview
```
Serves the static build from `dist/`

### Full Workflow (Ingest + Dev)
```bash
./catalog-dev.sh --ingest
```

### Ingest Only
```bash
pnpm catalog:ingest:local
```

## migrating to Remote Storage

To migrate from local files to Cloudflare R2:

1. Update `audioPath`, `renderStatsPath`, and `finalReport` fields to point to R2 URLs:
   ```yaml
   audioPath: "https://pub-xxxx.r2.dev/releases/..."
   ```

2. Or implement a `catalog-ingest.mjs` that uploads to R2

3. No component code changes needed—the player and UI use the URL paths directly

## File Structure

```
src/
├── content/
│   ├── config.ts           # Content schema with audioPath fields
│   └── releases/
│       └── continuo.md     # Example release with track URLs
├── components/
│   └── player/
│       ├── PlayerBar.svelte    # Persistent player (Svelte)
│       ├── playerStore.ts      # State management (nanostores)
│       └── useHowler.ts        # Howler.js wrapper
├── scripts/
│   └── ingest/
│       ├── catalog-ingest-local.mjs  # Local ingestion script
│       └── utils.mjs                 # HTML parsing utilities
└── styles/
    ├── tokens.css             # CSS design tokens
    └── global.css            # Global styles

public/
├── audio/         # MP3 files copied by ingest script
├── reports/       # HTML reports copied by ingest script
└── covers/        # Cover art copied by ingest script

docs/
├── PRD.md              # Product requirements
├── TDD.md              # Technical definitions (updated with local dev)
└── v0-local_opencode-prompt.md  # Original instructions

.catalog-dev.sh          # Dev wrapper script
.env.local.example       # Environment template
package.json             # Scripts: catalog:ingest:local, dev, build
astro.config.mjs         # Astro config (output: static)
```

## License

ISC
