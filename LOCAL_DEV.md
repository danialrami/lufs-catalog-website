# Local Development

How to run the LUFS Audio Catalog locally against `lufs-workchain` output, with no cloud
services. (One-time setup + production: see [`SETUP.md`](SETUP.md).)

## Quick Start

1. **Env:** `cp .env.local.example .env.local` (defaults are fine; `STORAGE_MODE=local`).
2. **Mount the NAS** so `/Volumes/project/continuo/catalogs` exists (or set
   `CATALOG_SOURCE_PATH` in `.env.local`).
3. **Ingest + dev server:**
   ```bash
   ./catalog-dev.sh --ingest        # or:  pnpm catalog:ingest && pnpm dev
   ```
4. Open **http://localhost:4321**.

## Local flow

```
Workchain output (/Volumes/project/continuo/catalogs/{album}/{track}_astro-catalog/)
        │  pnpm catalog:ingest          (STORAGE_MODE=local)
        ▼
  src/scripts/ingest/catalog-ingest.mjs
        ├─ transcode WAV→MP3 → public/audio/<collectionId>/<lufs-id>/<file>.mp3
        ├─ sanitized report  → public/reports/<collectionId>/<lufs-id>/final_report.html
        ├─ covers            → public/covers/<collectionId>/<lufs-id>/*.png
        └─ write/merge       → src/content/releases/<slug>.md
        ▼
  astro dev / build  →  serves everything from public/
```

In local mode `public/` is the asset store (it's gitignored — in production these live on
R2). Object keys are **stable per track**: the `<lufs-id>` path segment is the workchain
catalog number, not the track ordinal.

## Content model

Tracks carry storage-agnostic URL/key fields (schema in `src/content/config.ts`):

```yaml
tracks:
  - trackNumber: 1                                  # display order only
    audioPath: "/audio/<id>/<lufs-id>/<file>.mp3"   # local path; in remote mode this is an R2 key
    finalReport: "/reports/<id>/<lufs-id>/final_report.html"
    artwork: { main, identicon, spectrogram, canvasStatic }
```

Local paths work directly with Astro's static server. In remote mode, `audioPath` becomes a
private R2 key (resolved to a signed URL at play time) and `finalReport`/`artwork` become
absolute `cdn.lufsaud.io` URLs — **no component changes needed**, the UI uses whatever the
field holds.

## The player

The persistent bottom player uses Howler.js (HTML5 mode). Runtime state lives on a single
window-scoped singleton (`src/components/player/audioManager.ts`) so exactly one Howl ever
plays — even across Astro ViewTransitions — and position/volume/play-state are mirrored to
`localStorage` (every ~500ms) for seamless resume after a reload.

- Play button → starts playback; the player persists across navigation.
- Progress bar to seek; click/drag the volume slider; speaker icon to mute.
- **Keyboard:** Space = play/pause, ←/→ = volume.

Key files in `src/components/player/`: `PlayerBar.svelte` (UI island), `audioManager.ts`
(the single-Howl engine + state), `resolveAudio.ts` (turns a stored ref into a playable URL —
a local path as-is, or an R2 key exchanged for a signed URL via `PUBLIC_R2_STREAM_URL`).

## Commands

```bash
pnpm dev                     # dev server only (no ingest)
pnpm build                   # static build → dist/
pnpm preview                 # preview the build
pnpm catalog:ingest          # ingest only
./catalog-dev.sh --ingest    # ingest + dev server
pnpm test                    # unit (Vitest);  pnpm test:e2e for Playwright
```

## Going to production (remote storage)

Remote mode is built and live — you don't migrate by hand. Set `STORAGE_MODE=remote` plus the
`R2_*` / `R2_PUBLIC_BUCKET_NAME` / `PUBLIC_R2_BASE_URL` / `PUBLIC_R2_STREAM_URL` vars in
`.env.production`, then `pnpm catalog:ingest` uploads audio to the private R2 bucket and
covers/reports to the public CDN bucket and rewrites the `.md` URLs accordingly. Full
walkthrough (buckets, Worker, DNS, deploy): [`SETUP.md`](SETUP.md) and
[`docs/implementation/09-ingest-and-deploy.md`](docs/implementation/09-ingest-and-deploy.md).

## License

ISC
