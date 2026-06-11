# LUFS Audio Catalog Website

A static Astro/Svelte site for browsing and streaming LUFS Audio releases — with a
persistent bottom player that survives page navigation and an embedded, sanitized
**proof-of-work report** for every track (loudness, spectrograms, canvas video). Fed by
the `lufs-workchain` **astro-catalog** pipeline.

**Live:** [catalog.lufs.audio](https://catalog.lufs.audio)

---

## Quick Start (local preview)

```bash
pnpm install
cp .env.local.example .env.local        # defaults are fine (STORAGE_MODE=local)
# mount the NAS so CATALOG_SOURCE_PATH (/Volumes/project/continuo/catalogs) exists

./catalog-dev.sh --ingest               # ingest from the workchain output + start dev server
# or, if content already exists:
pnpm dev                                # dev server only → http://localhost:4321
```

Local mode writes MP3s + assets into `public/` and serves everything statically — no
cloud needed. Production streams from Cloudflare R2 (see **Production** below).

---

## Scripts

| Command | Action |
|---------|--------|
| `pnpm dev` | Astro dev server at `localhost:4321` |
| `pnpm build` | Build the static site to `dist/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm catalog:ingest` | Run the ingest (workchain output → MP3 + assets + content `.md`) |
| `pnpm worker:deploy` | Deploy the R2 signing Worker (`worker/`) |
| `pnpm test` / `pnpm test:e2e` | Vitest unit tests / Playwright E2E |
| `./catalog-dev.sh [--ingest]` | Local: (optionally ingest, then) start the dev server |
| `./catalog-sync.sh [--build]` | Local: ingest assets into `public/` (and optionally build) |
| `./catalog-deploy.sh [--ingest]` | Ingest (optional) → validate build → commit → push `main` (CI deploys) |

---

## Features

- **Persistent audio player** — playback continues seamlessly across navigation (Astro
  ViewTransitions + `transition:persist`). A single window-scoped Howl is guaranteed
  (no overlap/feedback), with position/volume/state synced to `localStorage`.
- **Protected streaming** — in production, audio is private on R2 and played via
  short-lived **signed URLs** minted per play by a Cloudflare Worker; no durable URL or
  key ever ships in the page, and the report is sanitized to remove any download path.
- **Embedded proof-of-work** — each track links/embeds its sanitized workchain report
  (loudness, spectrograms, canvas video) served from the CDN.
- **Keyboard + mouse controls** — Space to play/pause, ←/→ for volume, click/drag the
  volume slider, mute toggle.
- **Project filtering** and **responsive** (incl. a mobile-friendly playbar).

---

## Project Overview

- **Framework:** Astro v5 (`output: 'static'`)
- **UI:** Svelte 5 islands (the player bar)
- **Audio:** Howler.js v2 (HTML5 streaming)
- **State:** window-scoped audio singleton (`audioManager.ts`) + `localStorage`, persisted
  across navigation via Astro ViewTransitions
- **Content:** one Markdown file per release in `src/content/releases/` (schema in
  `src/content/config.ts`)
- **Storage:** local (`public/`) or Cloudflare R2 — private audio + a public CDN bucket for
  covers/reports (see below)

---

## Directory Structure

```
/
├── public/                  # local-mode assets (gitignored; on R2 in remote mode)
│   ├── audio/   covers/   reports/      # …/<collectionId>/<lufs-id>/…
├── src/
│   ├── content/{config.ts, releases/*.md}
│   ├── pages/{index.astro, releases/[slug].astro}
│   ├── components/player/   # PlayerBar.svelte, audioManager.ts, resolveAudio.ts
│   ├── layouts/  styles/
│   └── scripts/ingest/      # catalog-ingest.mjs, uploadR2.mjs
├── worker/                  # Cloudflare Worker that signs R2 audio GETs
├── catalog-dev.sh  catalog-sync.sh  catalog-deploy.sh
├── scripts/                 # catalog-process.sh, catalog-config.sh, catalog-set-origin.sh
├── .opencode/agents/        # the catalog-operator agent
└── docs/                    # PRD/TDD (historical) + implementation/ (current reference)
```

---

## Ingest Workflow

The ingest reads `lufs-workchain` **astro-catalog** output and generates site content.

**Source shape** (`CATALOG_SOURCE_PATH`, one album per top-level folder):

```
{album}/
  {track-name}.wav                 # source audio (ignored by the ingest)
  {track-name}_astro-catalog/      # the unit the ingest reads (one per track)
      context.json                 # status + metadata
      {track-name}_normalized.wav  # transcoded to MP3
      {track-name}_report.html     # sanitized → final_report.html
      artwork/  canvas/  catalog/catalog_info.txt  logs/normalization.json
```

`pnpm catalog:ingest` will, per track:
1. transcode the normalized WAV → **MP3 @320k** (duration via `ffprobe`);
2. sanitize the report (strip audio/download affordances) + copy its assets;
3. emit covers (artwork, identicon, spectrograms, canvas still);
4. write/merge `src/content/releases/<slug>.md`, preserving human-edited fields.

**Object keys are stable per track:** `releases|covers|reports/<collectionId>/<lufs-id>/…`,
where `<lufs-id>` is the workchain catalog number (a content hash), **not** the track's
ordinal — so adding/removing/reordering a track only touches that one track's objects.
`R2_PRUNE=dry|apply` cleans any orphans.

---

## Environment

**Local** (`.env.local`):
```bash
CATALOG_SOURCE_PATH=/Volumes/project/continuo/catalogs   # workchain output
PUBLIC_SHOW_DRAFTS=false                                  # show draft/unreleased locally
```

**Production** (`.env.production`, used by `pnpm catalog:ingest` with `STORAGE_MODE=remote`):
```bash
STORAGE_MODE=remote
R2_ACCOUNT_ID=…  R2_ACCESS_KEY_ID=…  R2_SECRET_ACCESS_KEY=…  R2_ENDPOINT=…
R2_BUCKET_NAME=lufs-catalog                       # PRIVATE — audio (signed)
R2_PUBLIC_BUCKET_NAME=lufs-catalog-public         # PUBLIC — covers + reports
PUBLIC_R2_BASE_URL=https://cdn.lufsaud.io         # public CDN domain
PUBLIC_R2_STREAM_URL=https://stream.lufsaud.io    # signing Worker (baked into the build)
```

`R2_*` and `CATALOG_SOURCE_PATH` are server/ingest-only; only `PUBLIC_*` reach the browser
bundle. Never commit `.env*`.

---

## Production

- **Storage:** audio → **private** `lufs-catalog` (streamed via short-lived signed URLs
  from the Worker at `stream.lufsaud.io`); cover art + the proof-of-work report → **public**
  `lufs-catalog-public`, served from `cdn.lufsaud.io`. The ingest bakes absolute CDN URLs
  into the content and drops the local copies, so git/Hostinger stay tiny.
- **Deploy:** push to `main` → **GitHub Actions** (`.github/workflows/deploy.yml`) builds and
  publishes `dist/` to the **`hostinger`** branch → Hostinger Git auto-deploy pulls it into
  `public_html`. `./catalog-deploy.sh [--ingest]` is the local convenience that ingests +
  validates + pushes `main`.
- One-time setup, account/DNS/credentials, and the publish loop: **[`SETUP.md`](SETUP.md)**.

---

## Tech Stack

- **Astro v5** — static SSG with islands
- **Svelte 5** — the player island
- **Howler.js v2** — HTML5 streaming playback
- **Cloudflare R2 + Worker (`aws4fetch`)** — object storage + signed audio URLs
- **node-html-parser** — sanitize/parse the workchain report
- **Vitest / Playwright** — unit + E2E tests

---

## Documentation

- **[`SETUP.md`](SETUP.md)** — one-time setup + the publish-a-release loop
- **[`docs/implementation/`](docs/implementation/)** — the working reference (start with
  `06` CDN/S3, `09` ingest & deploy, `11` runbook; `13` is the future-work roadmap)
- **[`.opencode/agents/catalog-operator.md`](.opencode/agents/catalog-operator.md)** — run the
  whole site in natural language (process, ingest, add/remove, deploy)
- `docs/PRD.md` / `docs/TDD.md` — the original product/technical design (historical; the
  implementation docs supersede them where they differ)
