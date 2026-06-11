# 09 — Ingest & Deploy (built in Phase 3)

What `catalog-ingest.mjs` and `catalog-deploy.sh` do, and the decision on the
GitHub Actions workflow. This reflects code that exists and was tested against the
real `3434` astro-catalog sample.

---

## 1. The ingest: `src/scripts/ingest/catalog-ingest.mjs`

A single, dependency-light Node script (Node stdlib + `ffmpeg`/`ffprobe` + the
existing `node-html-parser` dep, with a regex fallback) that turns workchain output
into catalog content.

### Source shape (canonical)
One album per top-level dir. Each track is a **`{track-name}_astro-catalog/`** dir in
the album root (side by side with the source audio), so an album can hold any number
of tracks:

```
{album}/
  {track-name}.wav                 source audio (ignored)
  {track-name}_astro-catalog/      ← one per track; the unit the ingest reads
  {another-track}.wav
  {another-track}_astro-catalog/
```

The ingest finds every `*_astro-catalog/` (or a bare `astro-catalog/`) dir that
contains a `context.json`, sorted alphabetically (prefix `01_`, `02_`, … for explicit
order). Track identity = the dir name minus `_astro-catalog`, reconciled with
context.json `input_name`; **track names are slugified for filenames/R2 keys** while
`displayTitle` keeps the real name (e.g. `Beta Two` → `beta-two.mp3`). Albums with no
`*_astro-catalog/` dir are **skipped** (reported, never fatal) — they still need the
workchain. Any individual `*_astro-catalog/` whose `context.json` `status` isn't
`completed` (or whose normalized WAV is missing) is **also skipped**, so a failed /
half-written workchain run never becomes a broken entry. The **release identity is the
folder name verbatim** — `a98ff_praise-legend-road` is the literal album name (hex
prefix kept; slug `a98ff-praise-legend-road`, title defaults to the folder name for
multi-track albums). `__MACOSX/` and `._*` are ignored.

> The earlier `astro-catalog/` (single) and `<n>/astro-catalog/` (numbered) shapes and
> the legacy `_final` handling are gone — everything is reprocessed into the
> `{track-name}_astro-catalog/` shape. There is now **one** ingest (`catalog:ingest` →
> `catalog-ingest.mjs`); `catalog-dev.sh` and `catalog-sync.sh` call it, and the old
> interactive `catalog-ingest-local.mjs` / `catalog:ingest:local` were removed (that
> legacy script is what produced the confusing 33-track run + `Title:` prompt).

### Metadata sources (structured, not scraped)
Per the confirmed sample (see also `02-observed-state.md`):
- **`context.json`** → resolves every output via its `path_template` (relative to the
  `astro-catalog/` dir — we deliberately ignore the absolute paths baked in, which
  point at Daniel's machine). Also gives `globals.saturation` and timestamps.
- **`catalog/catalog_info.txt`** → `catalogNumber` (`lufs-XXXXXXXX`) + full `sha256`.
- **`logs/normalization.json`** → `loudness` (target/final LUFS, true peak, LRA,
  sample rate, channels) — surfaced as proof-of-work.

### What it produces (local mode)
- **Audio:** transcodes `<name>_normalized.wav` → **MP3 @ 320 kbps** (`-codec:a
  libmp3lame -b:a 320k -joint_stereo 1 -map_metadata -1`) into
  `public/audio/<collectionId>/<lufs-id>/<name>.mp3`; **duration via `ffprobe`**.
- **Report:** sanitizes `<name>_report.html` (strips `<audio>`, `<source>`, and
  `download`/`*.wav`/`*.mp3` anchors so there's no download affordance — text
  mentions of filenames are harmless) → `public/reports/<collectionId>/<lufs-id>/final_report.html`,
  copying its `artwork/`, `canvas/`, `logs/` alongside so the embedded relative links
  resolve.
- **Covers:** `artwork.png` + `identicon/spectrogram/rectangle_spectrogram.png` +
  `canvas_static.png` → `public/covers/<collectionId>/<lufs-id>/`, plus a collection
  `cover.png`.
- **Content:** writes/merges `src/content/releases/<slug>.md` (schema in
  `src/content/config.ts`, now incl. an optional `loudness` block).

### Stable per-track keys (`<lufs-id>`, not the ordinal)
The `<lufs-id>` segment above is the track's **workchain catalog number** (`lufs-<hash>`
from `catalog/catalog_info.txt`) — a content-derived, position-INDEPENDENT id, **not** the
track's `trackNumber`. (Fallback if a catalog number is ever missing: `sha-<first-12-of-sha256>`,
then the slug.) Keying audio/covers/reports off this id is what makes **add / remove / reorder
touch only the changed track** — no renumber churn, so a prune after a removal clears just the
one removed track's `releases|covers|reports/<collectionId>/<lufs-id>/…` objects. Track display
ORDER still lives in the `.md` `trackNumber`; the collection `cover.png` sits at the collection
root (`covers/<collectionId>/cover.png`), so its key is position-independent too.

> **Migrating an existing positional catalog (one-time):** older catalogs were keyed
> `…/<collectionId>/<n>/…`. Re-key them with **no re-encode** via `R2_ADOPT_LEGACY_KEYS=1`
> (the ingest server-side-COPIES each audio object from its legacy positional key to the new
> `<lufs-id>` key), then prune the old keys. Full step-by-step in the `catalog-operator` agent
> ("One-time: migrate to stable per-track keys") and `uploadR2.mjs` / `catalog-ingest.mjs` headers.

### Edit-preserving merge (idempotent)
On re-ingest, machine fields (`catalogNumber`, `sha256`, `duration`, `loudness`,
asset paths, `processedDate`, `saturation`) are refreshed, while **human-owned
fields are preserved**: `title`, `project`, `releaseDate`, `status`, `isrc`,
`streamingLinks.*`, `tags`. New releases default to **`status: draft`** (so nothing
goes public until you flip it) and `project: "Singles"` for single tracks — edit and
re-run safely.

### Config (env)
`CATALOG_SOURCE_PATH`, `MP3_BITRATE` (default `320k`), `STORAGE_MODE`
(`local` now; `remote` = R2/rustfs upload is Phase 2), `CATALOG_OUTPUT_ROOT`
(testing), `CATALOG_ONLY` (process one album, for testing).

### System dependency
**`ffmpeg` + `ffprobe` must be on PATH** (the workchain already uses ffmpeg, so
Daniel's Mac has it). Documented here so it isn't a surprise on a fresh machine.

### Validated (2026-06-10) against the real `3434` sample
`42.9 MB normalized.wav → 8.9 MB MP3 @320k`, `ffprobe` duration **223 s**, catalog
`lufs-424b1054`, loudness final −13.14 LUFS / TP −1.5 / LRA 7 / 48 kHz / 2ch. Report
sanitized to **0** audio/source tags, **0** download links, **0** live `.wav`
src/href (kept imgs + the canvas video). Re-ingest preserved simulated human edits.

> **Status:** `STORAGE_MODE=remote` (R2) is the production default and is live — audio →
> the private `lufs-catalog` bucket, covers + reports → the public `lufs-catalog-public`
> bucket (`cdn.lufsaud.io`). Local mode still works for offline preview. The legacy
> album/`_final` shapes are gone; astro-catalog is the only ingest path. Object keys are
> stable per track (`releases|covers|reports/<collectionId>/<lufs-id>/…`) — see §"Stable
> per-track keys" above.

---

## 2. Deploy: `catalog-deploy.sh` → push `main` → CI → Hostinger

```
pnpm catalog:ingest          # (local) transcode + assets + content   [needs NAS + ffmpeg]
./catalog-deploy.sh [--ingest]
   ├── (optional) ingest
   ├── pnpm build             # validate the build only
   ├── git commit
   └── git push origin main  ──► GitHub Actions (.github/workflows/deploy.yml)
                                    ├── pnpm build  -> dist/
                                    └── publish dist/ -> `hostinger` branch
                                          │
                                          └── Hostinger Git auto-deploy -> public_html -> catalog.lufs.audio
```

Key point: **Hostinger static hosting doesn't build Astro**, so the branch it watches must
contain *built* output — but **CI now owns that build + publish**, not the local script.
`catalog-deploy.sh` only ingests (optional), validates the build, commits, and pushes `main`;
the `deploy.yml` workflow then builds and publishes `dist/` to the `hostinger` branch, which
Hostinger fast-forwards into `public_html`. (The workflow must NOT use `force_orphan` — that
rewrites `hostinger` as an orphan each run and breaks Hostinger's `git pull` on "divergent
branches"; linear history lets it auto-deploy. Template: `ci-deploy.yml`.)

---

## 3. The GitHub Actions workflow (`deploy.yml`) — **now the deploy path**

Earlier in the build-out the placeholder `deploy.yml` was removed (it was non-functional —
every deploy step commented out, `cache: pnpm` mis-ordered before pnpm setup, a bogus
double-build, deprecated actions) in favor of a purely local `catalog-deploy.sh`. **That
decision was later reversed: CI now owns build + publish**, so a push to `main` deploys
without anyone running a local build. The live workflow:
- triggers on push to `main` (+ manual `workflow_dispatch`);
- `pnpm install` → `pnpm build`, baking `PUBLIC_R2_STREAM_URL` / `PUBLIC_SITE_URL` (repo
  Variables with production fallbacks, so audio can't silently break on a missing var);
- publishes `dist/` to the `hostinger` branch with `peaceiris/actions-gh-pages` (no
  `force_orphan`, so Hostinger fast-forwards).

`catalog-deploy.sh` remains for offline/local deploys (build + commit + push `main`); both
publish through the same `hostinger` branch. Template + rationale live in `ci-deploy.yml`
(the bot can't commit under `.github/workflows/` itself, so that file is copied into place
by hand).

> Sandbox note: the build can't be verified in the agent sandbox (the npm registry is
> blocked there), so `pnpm build` runs in CI (or on Daniel's Mac). The ingest logic *was*
> verified in-sandbox because it only needs Node + ffmpeg.

---

## 4. Phase 2: storage + protected streaming (built)

### 4.1 Bucket model (a correction to the PRD/TDD)
R2 public access is **bucket-level**, not per-prefix — attaching a public r2.dev URL
or custom domain exposes the *whole* bucket. So the "`releases/` private, `reports/`
public within one bucket" idea in the PRD/TDD isn't how R2 works. The implemented
model is simpler and cheaper:

- **Private bucket `lufs-catalog`** — the **audio MP3s** (`releases/<id>/<lufs-id>/…`),
  served only via short-lived presigned URLs from the Worker. Nothing public points at it.
- **Public bucket `lufs-catalog-public`** — **cover art + the full proof-of-work report**
  (incl. the canvas video/gif + spectrograms), served read-only from `PUBLIC_R2_BASE_URL`
  (`cdn.lufsaud.io`). The ingest bakes those absolute CDN URLs into the `.md` and **removes
  the local `public/` copies after upload**, so neither git nor the `hostinger` deploy
  carries heavy assets.
- The **45 MB Spotify-canvas GIF** now ships *only* inside the public-bucket report (kept for
  full fidelity); it is still never committed to git.

(Both buckets take same-key PUTs, so re-ingest overwrites in place and never grows storage.
If the public bucket isn't configured, the ingest falls back to committing covers/reports
under `public/` — the older single-bucket behavior, fine at small scale.)

### 4.2 Pieces
- **`worker/`** — `lufs-catalog-stream`, a tiny Cloudflare Worker that presigns GET
  URLs for `releases/…` keys using `aws4fetch` (Workers-native; no AWS SDK / no
  `nodejs_compat`). Origin-locked to `ALLOWED_ORIGIN`; only signs `releases/` keys;
  TTL via `URL_TTL_SECONDS` (default 1h). Deploy: `npm run worker:deploy`. Setup in
  `worker/README.md`.
- **`src/scripts/ingest/uploadR2.mjs`** — `uploadObject(localPath, key, contentType, { bucket,
  metadata })` via `@aws-sdk/client-s3` (lazy-loaded; remote mode only), plus `headObjectMeta`
  (skip-if-unchanged), `listKeys` / `deleteKeys` (the manifest-aware prune), and `copyObject`
  (server-side re-key, used by the stable-key migration). Includes a commented rustfs mirror (doc 07).
- **ingest remote mode** — with `STORAGE_MODE=remote`, the MP3 is transcoded to a
  temp file, uploaded to `releases/<collectionId>/<lufs-id>/<file>.mp3`, and the track's
  `audioPath` is set to that **key** (not a `/audio/…` path). Reports + covers still
  go to `public/`.
- **player** — `src/components/player/resolveAudio.ts` turns a stored ref into a
  playable URL: `/…` or `http(s)` → used as-is (local, unchanged); otherwise treated
  as an R2 key and exchanged for a signed URL via `PUBLIC_R2_STREAM_URL`.
  `audioManager.loadAudio()` builds the Howl synchronously for direct URLs (local
  behavior preserved) and asynchronously after signing for keys. The NAS failover is
  present but commented.

### 4.3 The R2 ↔ rustfs switch
`STORAGE_PRIMARY`, `STORAGE_MIRROR`, `STREAM_FALLBACK_ENABLED` live in
`.env.production` and are flipped with `scripts/catalog-set-origin.sh`. The rustfs
dual-write (`uploadR2.mjs`) and player failover (`resolveAudio.ts`) are written but
commented until the NAS endpoint exists (doc 07 has the stand-up checklist).

### 4.4 Build-sensitive — verify after `pnpm build`
The Node/Worker pieces are correct-by-construction, but the **player edit**
(`audioManager.ts` + `PlayerBar.svelte`) and the worker both need a real build/deploy
to confirm. Local playback is preserved by the direct-URL short-circuit, so the risk
is confined to the remote-streaming path (which only matters once R2 is set up).
`@aws-sdk/client-s3` was added to root deps → run `pnpm install` after pulling.
