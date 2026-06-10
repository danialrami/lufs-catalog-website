# 09 — Ingest & Deploy (built in Phase 3)

What `catalog-ingest.mjs` and `catalog-deploy.sh` do, and the decision on the
GitHub Actions workflow. This reflects code that exists and was tested against the
real `3434` astro-catalog sample.

---

## 1. The ingest: `src/scripts/ingest/catalog-ingest.mjs`

A single, dependency-light Node script (Node stdlib + `ffmpeg`/`ffprobe` + the
existing `node-html-parser` dep, with a regex fallback) that turns workchain output
into catalog content.

### Shapes it recognizes (`classify()`)
| Shape | Detector | Handled |
|---|---|---|
| astro-catalog single-track | `<album>/astro-catalog/context.json` | ✅ full |
| astro-catalog multi-track | `<album>/<n>/astro-catalog/context.json` | ✅ full |
| legacy hex_slug album | `^[a-f0-9]+_…` + numbered `*_final/` | ⛔ skipped (use `catalog-ingest-local.mjs`, or re-run through the workchain) |
| legacy single `*_final` | dir ends `_final` | ⛔ skipped |
| raw / unprocessed | none of the above | ⛔ skipped (needs the workchain first) |

Skipped albums are reported, never fatal. `__MACOSX/` and `._*` resource forks are
ignored.

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
  `public/audio/<collectionId>/<n>/<name>.mp3`; **duration via `ffprobe`**.
- **Report:** sanitizes `<name>_report.html` (strips `<audio>`, `<source>`, and
  `download`/`*.wav`/`*.mp3` anchors so there's no download affordance — text
  mentions of filenames are harmless) → `public/reports/<collectionId>/<n>/final_report.html`,
  copying its `artwork/`, `canvas/`, `logs/` alongside so the embedded relative links
  resolve.
- **Covers:** `artwork.png` + `identicon/spectrogram/rectangle_spectrogram.png` +
  `canvas_static.png` → `public/covers/<collectionId>/<n>/`, plus a collection
  `cover.png`.
- **Content:** writes/merges `src/content/releases/<slug>.md` (schema in
  `src/content/config.ts`, now incl. an optional `loudness` block).

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

> **Not yet:** R2/rustfs upload (`STORAGE_MODE=remote`) lands in Phase 2 via
> `uploadR2.mjs`; the script already branches on `STORAGE_MODE` and warns. Legacy
> album/`_final` shapes are skipped for now (only the Continuo album used them; the
> path forward is astro-catalog).

---

## 2. Deploy: `catalog-deploy.sh` + Hostinger webhook (no CI)

```
pnpm catalog:ingest         # (local) transcode + assets + content   [needs NAS + ffmpeg]
./catalog-deploy.sh [--ingest]
   ├── pnpm build            -> dist/
   ├── git push origin main  (source)
   └── publish dist/  ->  `hostinger` branch  (built output, via a throwaway repo)
                              │
                              └── Hostinger Git auto-deploy webhook -> public_html -> catalog.lufs.audio
```

Key point: **Hostinger static hosting doesn't build Astro**, so the branch it watches
must contain *built* output. `catalog-deploy.sh` builds locally and publishes only
`dist/` to the `hostinger` branch (using a temporary repo, so `dist/` never has to be
committed to `main`). The Hostinger side is exactly the "GitHub → webhook →
auto-deploy" flow Daniel already uses for the Hugo blog — just pointed at the
`hostinger` branch.

---

## 3. Decision: the GitHub Actions workflow (`deploy.yml`) — **removed**

The existing `.github/workflows/deploy.yml` was a **non-functional placeholder**:
- every real deploy step was commented out (it only built + uploaded an artifact),
- it had bugs (`cache: pnpm` ordered before pnpm setup; a bogus `pnpm build --out
  dist` double-build; deprecated `setup-node@v3` / `upload-artifact@v3`), and
- it duplicated/contradicted the local-build + webhook model.

Since (a) deployment is handled by `catalog-deploy.sh` + the Hostinger webhook, and
(b) the build already runs locally right before each deploy (so a CI build-check is
redundant for a solo workflow), **we removed it** to keep one clear deploy path.

**If we ever want CI back**, the one genuinely useful job would be a *build-health
check* on PRs (no secrets, no deploy): `pnpm install --frozen-lockfile && pnpm build
&& pnpm astro check`. That catches a broken content `.md` or dependency before it
reaches the deploy script. It's easy to add later as `.github/workflows/ci.yml`; it's
intentionally omitted now per the "keep it simple, deploy via webhook" preference.

> Sandbox note: the build itself can't be verified in the agent sandbox (the npm
> registry is blocked there), so `pnpm install && pnpm build` runs on Daniel's Mac
> (or in the optional CI). The ingest logic above *was* verified in-sandbox because
> it only needs Node + ffmpeg.
