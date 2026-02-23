# PRD — LUFS Audio Catalog Website
**Document version:** 0.2 — 2026-02-22
**Owner:** Daniel Ramirez
**Target URL:** catalog.lufs.audio
**Status:** Draft — updated for Hostinger hosting + workchain directory schema

***

## 1. Overview

`catalog.lufs.audio` is a publicly accessible, read-only music catalog and archive for LUFS Audio releases. It serves as the canonical proof-of-work record for every audio production, surfacing per-release metadata (workchain catalog number, ISRC, HTML report archive), an inline audio player, and streaming links — while intentionally preventing downloads. It ships as a fully static Astro site hosted on Hostinger, with audio served from Cloudflare R2 through a standalone signing Worker. The deploy script mirrors the existing Hugo blog workflow: ingest → build → push → auto-deploy.

***

## 2. Goals

- **G1** — Publish a browsable grid of releases, organized by project/series, with filter/legend
- **G2** — Stream audio inline (Spotify-style persistent bottom bar); no downloads
- **G3** — Expose both workchain HTML reports per track ("proof of work") — `_final_report.html` embedded, `render_stats.html` linked
- **G4** — Display workchain catalog number (`lufs-[sha256-prefix]`) and ISRC per release
- **G5** — Automate new-release ingestion: workchain export directory → `catalog-ingest.sh` → `catalog-deploy.sh` → Hostinger live
- **G6** — Match LUFS brand identity (colors, type, retro-professional aesthetic) across all existing properties
- **G7** — Ship as a foundation: modular enough that a portfolio-site footer embed, an unreleased/drafts section, and additional scripted loaders can be added without restructuring
- **G8** — All configurable paths, URLs, and credentials live in a single `.env` file

***

## 3. Non-Goals (v1)

- Programmatic uploads to DistroKid
- User accounts, comments, or social features
- Download functionality for released tracks
- CMS UI (file + script driven)
- Migration of SoundCloud/December 2024 unreleased material (noted for v2)

***

## 4. Users & Contexts

| User | Need |
|---|---|
| General visitor / fan | Browse releases, stream audio, find DSP links |
| Industry / press | Verify ISRC, catalog number, SHA256 provenance |
| Daniel (owner) | Ingest from workchain directory with one command; no manual asset copying |
| Portfolio visitors (future) | Arrive via footer embed on `portfolio.lufs.audio` |

***

## 5. Feature Requirements

### 5.1 Catalog Grid (Home Page)

- Responsive CSS grid of release cards, 3–4 columns, dark theme
- Each card: collection cover art, title, workchain catalog number (monospace badge), release date, project badge
- **Project legend** — sticky filter bar at page top listing all distinct `project` values; clicking filters the grid client-side; "All" resets
- Cards link to collection detail pages at `/releases/[slug]`

### 5.2 Release Detail Page

Each collection (album/EP) gets a page at `/releases/[slug]`:

- Full cover art + metadata header: title, artist, catalog number(s), ISRC, release date, project
- Track listing — each track row shows: track number, display name, catalog number, duration, play button (feeds global player)
- Streaming platform links (Spotify, Apple Music, Bandcamp, SoundCloud as applicable)
- **Proof of Work section** — per track, collapsible: embedded `_final_report.html` in a sandboxed `<iframe>` (sanitized: "Download" button removed by ingest script) + a "View render stats →" link pointing to the R2 public report URL
- Artwork gallery: identicon, spectrogram, canvas still — sourced from R2 `artwork/` prefix

### 5.3 Audio Playback — Global Bottom Bar

- Persistent Spotify-style player bar fixed to the bottom viewport edge on every page
- Survives client-side navigation without re-mounting or interrupting playback (`transition:persist`)
- Controls: play/pause, previous/next, scrub bar + timestamps, volume slider, track title + thumbnail
- When a track play button is clicked anywhere on the site, the frontend fetches a presigned URL from the **standalone Cloudflare Worker** at `STREAM_WORKER_URL` (env var), instantiates Howler.js with it, and begins playback — the R2 key is never written into the HTML

### 5.4 Unreleased / Archive Section *(v1: infrastructure only)*

- `status: "released" | "unreleased" | "draft"` field in content schema from day one
- `draft` and `unreleased` excluded from the public grid
- `SHOW_DRAFTS=true` env var exposes them with a visual badge for local preview
- SoundCloud archive and December 2024 release noted as future candidates

### 5.5 Update Workflow

After DistroKid approval, the minimal owner steps are:

1. Audio workchain has already run and produced the export directory at `$CATALOG_SOURCE_PATH/[collection-id]/`
2. Owner runs: `./catalog-deploy.sh --ingest`
   - The `--ingest` flag triggers `pnpm catalog:ingest` first, which walks the source directory, parses both HTML reports, copies/uploads assets, and writes/updates the collection's `.md` file
   - Then runs `pnpm build` (Astro static build to `dist/`)
   - Commits and pushes to GitHub `main`
   - `git subtree split --prefix dist` → force-pushes to the `hostinger` branch
3. Hostinger webhook fires → auto-deploys `dist/` to `public_html`
4. Done — owner manually adds streaming links to the `.md` once they're live on DSPs

***

## 6. Design Requirements

### 6.1 Color Palette (LUFS brand only) [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/17d823ed-b169-454b-a822-ebce7b4ef2cd/color-swatches.md)

| Token | Hex | Role |
|---|---|---|
| `--color-bg` | `#111111` | Page background (black key) |
| `--color-surface` | `#1a1a1a` | Cards, player bar |
| `--color-surface-2` | `#242424` | Hover states, nested surfaces |
| `--color-text` | `#fbf9e2` | Primary text (white/cream accent) |
| `--color-text-muted` | `#E2E3D8` | Secondary text (light key) |
| `--color-teal` | `#78BEBA` | Primary accent, links, active states |
| `--color-red` | `#D35233` | Alerts, error, "released" status badge |
| `--color-yellow` | `#E7B225` | Catalog number badge, hover highlights |
| `--color-blue` | `#2069AF` | Project type badges |
| `--color-border` | `rgba(251,249,226,0.08)` | Subtle dividers |

### 6.2 Typography [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/45bd4434-f3a8-4488-95ef-16d35383e6db/Brand-guidelines-LUFS.pdf)

- **Monospace / data** → `SF Mono Regular`: catalog numbers, ISRC, SHA256, timestamps, duration values, all code-like fields
- **Body / headings** → `Host Grotesk Regular` + `Host Grotesk Bold`
- Fallback stack: `"SF Mono", "JetBrains Mono", ui-monospace, monospace` and `"Libre Franklin", system-ui, sans-serif`

### 6.3 Aesthetic Direction

Dark background with sparse, high-contrast color accents. Cover art as the sole photography. Catalog numbers, SHA256 hashes, and LUFS values displayed in monospace as prominent data elements — leaning into the "record label internal system made public" feel. Subtle hover animations consistent with the webring button (provided): shadow pulse, micro-float. No gradients, no decorative imagery.

***

## 7. Source Directory Schema

The workchain produces a directory structure at `$CATALOG_SOURCE_PATH` that the ingest script reads directly:

```
$CATALOG_SOURCE_PATH/
└── [hash-prefix]_[bip39-words]/          ← collection (album/EP)
    ├── artwork/
    │   └── YYYY-MM-DD_artwork.png         ← collection cover art
    ├── [track-number]/                    ← e.g., "1", "2", "3"
    │   ├── [filename]_final/
    │   │   ├── [filename]_final_report.html   ← workchain report (13KB)
    │   │   ├── artwork/
    │   │   │   ├── [filename]_artwork.png
    │   │   │   └── components/
    │   │   │       ├── identicon.png
    │   │   │       ├── rectangle_spectrogram.png
    │   │   │       └── spectrogram.png
    │   │   ├── audio/original/[filename].wav
    │   │   ├── canvas/
    │   │   │   ├── [filename]_canvas_static.png
    │   │   │   ├── [filename]_canvas.gif
    │   │   │   └── [filename]_canvas.mp4
    │   │   ├── catalog/catalog_info.txt
    │   │   └── logs/
    │   ├── [filename].render_stats.html   ← REAPER render stats (109KB+)
    │   ├── [filename].wav
    │   └── [filename].mp3                 ← already converted; used for streaming
    └── bip39-english.txt
```

**Key facts derived from this schema:**
- The `.mp3` exists at the track root — no conversion needed during ingest
- `_final_report.html` contains: catalog number (`lufs-[hash8]`), full SHA256, processed date, saturation value [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/a6fb8dfe-f7f9-4f47-a3f0-7564b1914535/11-01-22.2181-03-42.773_final_report.html)
- `render_stats.html` contains REAPER loudness/render statistics (LUFS, peak, duration, sample rate) — large file; stored in R2, not committed to the git repo
- `_final_report.html` is small enough (≈13KB) to commit to `public/reports/`
- Collection directory name encodes: `[sha256-prefix]_[bip39-word]-[bip39-word]-[bip39-word]`
- Human-readable release title (e.g., "Continuo") is separate from the directory name and is set manually during ingest prompt or post-ingest edit

***

## 8. Content Model

One `.md` file per **collection** in `src/content/releases/`. Tracks are an array within frontmatter.

```yaml
# src/content/releases/continuo.md
title: "Continuo"                       # human-readable; set manually
slug: "continuo"
collectionId: "a98ff_praise-legend-road"  # workchain directory name
project: "Continuo"                     # series, for legend filter
artist: "Daniel Ramirez"
releaseDate: 2024-10-01
status: "released"                      # released | unreleased | draft
coverArt: "/covers/a98ff_praise-legend-road/artwork.png"
isrc: "USXXXXXXXX2401"                  # from DistroKid; set manually
streamingLinks:
  spotify: ""
  appleMusic: ""
  bandcamp: ""
  soundcloud: ""
tags: ["ambient", "piano"]

tracks:
  - trackNumber: 1
    displayTitle: "11-01-22"            # humanized; can be edited
    filename: "11-01-22.2181-03-42.773"
    catalogNumber: "lufs-5cfa866d"      # from _final_report.html
    sha256: "5cfa866df20ef588681bdaef656d4b12a50aed43f0ea9afdf276516a54bfa5c3"
    processedDate: "2026-02-22T16:50:08"
    saturation: 0.5
    r2Key: "releases/a98ff_praise-legend-road/1/11-01-22.2181-03-42.773.mp3"
    r2ReportKey: "reports/a98ff_praise-legend-road/1/render_stats.html"
    duration: 0                         # seconds; parsed from render_stats or ffprobe
    finalReport: "reports/a98ff_praise-legend-road/1/final_report.html"
    artwork:
      main: "/covers/a98ff_praise-legend-road/1/artwork.png"
      identicon: "/covers/a98ff_praise-legend-road/1/identicon.png"
      spectrogram: "/covers/a98ff_praise-legend-road/1/spectrogram.png"
      canvasStatic: "/covers/a98ff_praise-legend-road/1/canvas_static.png"
```

***

## 9. Success Criteria (Day 1)

- `catalog.lufs.audio` is live with the *Continuo* release fully populated
- Audio streams correctly via the Cloudflare Worker; no R2 key in the HTML
- Bottom player persists across all page navigation without interruption
- `_final_report.html` is embedded (sanitized) on the release detail page
- Catalog number `lufs-5cfa866d` and SHA256 are displayed in monospace
- Catalog grid with project legend renders correctly
- `catalog-deploy.sh` runs end-to-end without manual steps after DistroKid upload