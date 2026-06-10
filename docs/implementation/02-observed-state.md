# 02 — Observed State

A precise snapshot of the repo **as it exists today** (branch `main`), based on a
full read of the source. This is the "you are here" map.

Status keys: ✅ built · 🟡 partial · ⛔ spec-only

---

## 1. The site (good shape) ✅

- **Astro v5**, `output: 'static'` (`astro.config.mjs`) — no SSR, no adapter.
- **Svelte 5** island for the player; **Howler.js v2** for audio; **nanostores /
  @nanostores/persistent** for cross-island, cross-navigation state.
- **Persistent bottom player**: Astro View Transitions + `transition:persist`, with
  playback position/volume/state mirrored to `localStorage` (~every 500ms) so it
  survives even full reloads.
- Keyboard shortcuts (space, arrows), click/drag volume, mute.
- Content model: one Markdown file per release in `src/content/releases/`, schema in
  `src/content/config.ts`.
- Tests scaffolded: Vitest (unit) + Playwright (e2e).
- Pages: `src/pages/index.astro` (grid) + `src/pages/releases/[slug].astro` (detail).

**One real release exists:** `src/content/releases/continuo.md` →
collection `a98ff_praise-legend-road`.

---

## 2. The local ingest (works for ONE shape) 🟡

`src/scripts/ingest/catalog-ingest-local.mjs` (+ `utils.mjs`):

- Walks `CATALOG_SOURCE_PATH` (default `/Volumes/project/continuo/catalogs`).
- **Only recognizes collection dirs matching `^([a-f0-9]+)_(.+)$`** — i.e. the
  `<hex>_<bip39-slug>` album shape. Everything else in the catalog is **silently
  skipped**.
- For each numbered track subdir (`^\d+$`), it looks for a `*_final/` dir containing
  `<finalDir>_report.html` and a loose `.mp3` at the track root.
- Parses the report HTML with regexes (`Catalog Number:`, `Full SHA256 Hash:`,
  `Processed:`, `Saturation:`, `File:`).
- Copies MP3 → `public/audio/…`, sanitized report → `public/reports/…` (strips
  download links), artwork/canvas/logs/catalog → `public/…`, cover art → `public/covers/…`.
- Writes `src/content/releases/<slug>.md`.

**Net effect:** it currently ingests **only the `Continuo` album**. That is the
"working with local files" proof of concept.

---

## 3. Known gaps & stubs ⛔ / 🟡

| Item | State | Notes |
|------|-------|-------|
| Cloud upload to R2 | ⛔ | `uploadR2.mjs` / `catalog-ingest.mjs` exist only in the TDD. No `@aws-sdk/client-s3` dependency. |
| Signing Worker | ⛔ | No `worker/` directory, no `wrangler.toml`. |
| Deploy script | ⛔ | `catalog-deploy.sh` (build→push→subtree-split→hostinger) not present. Only local `catalog-dev.sh` + `catalog-sync.sh`. |
| `.env.production` | ⛔ | Referenced in `.env.local.example` but not present. |
| Duration | 🟡 | `getAudioDuration()` is a hardcoded `return 0`; no ffprobe. |
| Merge of existing releases | 🟡 | `handleRelease()` detects an existing `.md` but the "update tracks / preserve edits" branch is a TODO; it currently only fully writes on first creation. |
| Multi-shape ingest | ⛔ | Only the album shape is parsed (see §4). |

---

## 4. Source-shape taxonomy (critical for Phase 3)

The real catalog at `/Volumes/project/continuo/catalogs` contains **several distinct
shapes**. The current ingest handles only one of them. The new pipeline must handle
at least the first three:

### A) NEW — astro-catalog single-track (the target format) ⛔ not handled
Example: `3434/`
```
3434/
├── 3434.wav
└── astro-catalog/
    ├── context.json            ← structured metadata (parse THIS)
    ├── 3434_normalized.wav
    ├── 3434_original.wav
    ├── 3434_report.html        ← note: "_report.html", not "_final_report.html"
    ├── artwork/{..._artwork.png, components/{identicon,spectrogram,rectangle_spectrogram}.png}
    ├── canvas/{_canvas_static.png, _canvas.gif, _canvas.mp4}
    ├── catalog/catalog_info.txt
    └── logs/{normalization.json, normalization.log, artwork_generation.log, canvas_generation.log}
```
**Why it's not handled today:** dir name `3434` doesn't match `^[a-f0-9]+_.+$`; the
metadata lives in `context.json` (not the old report); **there is no `.mp3`** — only
WAV — so a **transcode step is required**.

### B) Multi-track album (currently handled) 🟡
Example: `a98ff_praise-legend-road/`
```
a98ff_praise-legend-road/
├── artwork/YYYY-MM-DD_artwork.png        ← collection cover
├── 1/ … 33/                              ← numbered tracks
│   ├── <file>_final/<file>_final_report.html + artwork/ …
│   ├── <file>.wav
│   ├── <file>.mp3                        ← pre-made web mp3
│   └── <file>.render_stats.html
└── bip39-english.txt, organize_audio.sh, …
```

### C) LEGACY — single-track `_final/` at catalog root ⛔ not handled
Examples: `10-00.0006-37.182_final/`, `my-mind/my-mind_final/`, `my-mind/if-you-only-knew_final/`
```
<name>_final/
├── <name>_final_report.html
├── audio/{original,normalized,protected}/<...>.wav
├── artwork/ … canvas/ … catalog/ … logs/ …
```
Note: these use the older `audio/{original,normalized,protected}` layout and a
`_normalized_protected` step. Mostly WAV → also need transcode.

### D) RAW, unprocessed (out of scope until run through the workchain)
Folders of loose audio with no workchain output: `footlights/`, `hogtagon/`,
`masked/`, `pulse/`, `soundcloud/`, `ambulance/`, `animal/`, `elegant-picking/`,
`reminisce-reprise/`, `HH/`. These are **not** catalog entries yet — they're source
material. Ingest should ignore them (optionally list them as "unprocessed" for
Daniel's awareness).

---

## 5. What `context.json` buys us

The old path regex-scrapes an HTML report — brittle. The astro-catalog chain emits
`context.json` + `logs/normalization.json`, which should give structured, reliable
fields (catalog number, SHA256, processed date, loudness/LUFS, true peak, sample
rate, etc.). **Phase 3 will prefer `context.json`** and keep HTML parsing only as a
fallback for older shapes. _(Exact field names TBD once we have a sample — see the
Phase 3 first task.)_

---

## 6. Environment & scripts as they stand

- `.env.local.example` → `CATALOG_SOURCE_PATH`, `PUBLIC_SITE_URL`, `SHOW_DRAFTS`,
  `R2_MODE=false`, (commented) `STREAM_WORKER_URL`.
- `package.json` scripts: `catalog:ingest:local`, `dev`, `build`, `preview`,
  `test`, `test:e2e`.
- `catalog-dev.sh` (ingest + dev server), `catalog-sync.sh` (ingest [+ build]).

**Bottom line:** the bones are solid and the design is sound; the missing pieces are
the **cloud upload**, the **Worker**, the **deploy script**, **duration**, and a
**multi-shape, `context.json`-aware ingest with WAV→MP3 transcode**.
