# 05 — Architecture

How the pieces fit, in both the **local** and **production** modes, plus the content
model and the organization scheme.

---

## 1. Two modes, one codebase

The same site runs in two modes; only the **values** in the content files (and a few
env flags) differ.

### Local-only (today)
```
Mac + NAS (/Volumes/project/continuo/catalogs)
        │  pnpm catalog:ingest:local
        ▼
  catalog-ingest-local.mjs
        ├─ copies MP3   → public/audio/...
        ├─ copies report→ public/reports/...
        ├─ copies art   → public/covers/...
        └─ writes       → src/content/releases/*.md   (audioPath = /audio/...)
        ▼
  astro dev / build  →  http://localhost:4321  (serves everything from public/)
```

### Production (target)
```
Mac + NAS                                  Cloudflare
  pnpm catalog:ingest                       ┌───────────────────────────┐
    ├─ transcode WAV→MP3 (ffmpeg)           │  R2 bucket: lufs-catalog     │
    ├─ upload audio   ───────────────────►  │   releases/  (PRIVATE)     │
    ├─ upload reports ───────────────────►  │   reports/   (public)      │
    ├─ upload artwork ───────────────────►  │   artwork/   (public)      │
    ├─ (opt) mirror → NAS rustfs (fallback) └───────────▲───────────────┘
    └─ write/merge src/content/releases/*.md            │ getSignedUrl (1h)
  catalog-deploy.sh                          ┌───────────┴───────────────┐
    ├─ pnpm build → dist/                     │  Worker (stream.lufs.audio)│
    ├─ git push origin main                   │  signs releases/ GETs      │
    └─ subtree split dist → hostinger branch  └───────────▲───────────────┘
        │ webhook                                          │ fetch ?key=
        ▼                                                  │
  Hostinger  public_html/ ← dist/            Browser ──────┘
  catalog.lufs.audio  (static HTML/CSS/JS)   (Howler plays the signed URL)
```

Key point: **the HTML is static and dumb about audio** — it holds a *key*, not a URL.
At play time the player asks the Worker for a fresh signed URL. Public assets
(reports, artwork) are fetched directly from their public R2 URLs.

---

## 2. Request lifecycle (a play click, in production)

1. User clicks ▶ on a track. The page has the track's R2 **key**
   (`releases/<collectionId>/<lufs-id>/<file>.mp3` — keyed by the per-track catalog id, not
   the ordinal; see `09-ingest-and-deploy.md`), not a URL.
2. `useHowler.ts` calls `GET {STREAM_WORKER_URL}?key=<key>`.
3. The Worker checks the `Origin` (must be `catalog.lufs.audio`), validates the key
   prefix (`releases/`, no `..`), and returns a **1-hour presigned URL**.
4. Howler streams from that URL (`html5: true`, so it doesn't buffer the whole file).
5. The URL expires; it was never durable and never in the static HTML.

If R2/Worker is unreachable **and** the fallback is enabled, step 2–4 retry against
the rustfs endpoint (see doc 07).

---

## 3. Content model (`src/content/config.ts`)

One Markdown file per **collection/release**; tracks are an array in frontmatter.
Current schema (abridged):

```yaml
title: "Continuo"                 # human-edited
collectionId: "a98ff_praise-legend-road"
project: "Continuo"               # legend/filter key
artist: "Daniel Ramirez"
releaseDate: 2024-10-01
status: "released"                # released | unreleased | draft
coverArt: "/covers/.../artwork.png"
isrc: "US-XXX-YY-NNNNN"           # human-edited (post-DSP)
streamingLinks: { spotify, appleMusic, bandcamp, soundcloud }  # human-edited
tags: [ambient, piano]
tracks:
  - trackNumber: 1
    displayTitle: "..."
    filename: "..."
    catalogNumber: "lufs-5cfa866d"   # machine-derived
    sha256: "...64 hex..."           # machine-derived
    processedDate: "2026-02-22T16:50:08"
    saturation: 0.5
    audioPath: "/audio/.../x.mp3"    # local path OR R2 key/URL
    renderStatsPath: "/reports/.../render_stats.html"
    finalReport: "/reports/.../final_report.html"
    duration: 0                      # seconds (ffprobe; currently 0)
    artwork: { main, identicon?, spectrogram?, canvasStatic? }
```

**Field ownership (for the edit-preserving merge):**

| Owner | Fields |
|-------|--------|
| **Machine** (ingest writes/overwrites) | `collectionId`, `catalogNumber`, `sha256`, `processedDate`, `saturation`, `audioPath`, `renderStatsPath`, `finalReport`, `duration`, `artwork.*`, `filename` |
| **Human** (ingest must preserve) | `title`, `project`, `releaseDate`, `status`, `isrc`, `streamingLinks.*`, `tags`, `displayTitle` (once edited) |

> Phase 3 will likely extend the schema with optional structured loudness fields
> (LUFS, true peak, sample rate) once we see `context.json`. The `audioPath`-as-key
> vs `audioPath`-as-URL convention will be finalized when the Worker lands (the
> player needs a key to sign; public assets can be full URLs).

---

## 4. Source-shape handling (Phase 3)

A `classifyEntry(dir)` step maps each top-level entry to a handler:

| Shape | Detector | Handler |
|-------|----------|---------|
| astro-catalog single-track | has `astro-catalog/context.json` | read context.json; transcode `*_normalized.wav`→mp3; one track |
| album | name matches `^[a-f0-9]+_.+$` + numbered subdirs | per-track `_final/` (existing logic, generalized) |
| legacy `_final` | dir endswith `_final` or contains `*_final/` with `audio/{original,normalized,protected}` | parse report HTML; transcode chosen WAV |
| raw / unprocessed | none of the above | **skip** (optionally log as "needs workchain") |

Defensive defaults: unknown → skip with a warning, never crash the run.

---

## 5. Organization scheme (by project / year / flat)

Configurable via env (e.g. `CATALOG_ORGANIZE=project|year|flat`). This affects:

- the **grouping/legend** on the grid (group header per project, or per year), and
- the **grouping/legend** only — NOT the R2 key layout.

Realized: R2 keys are **stable and keyed off the per-track id**
(`releases/<collectionId>/<lufs-id>/…`, where `<lufs-id>` is the workchain catalog number),
and project/year are purely **presentation metadata** (frontmatter `project`, derived `year`
from `releaseDate`). Keying off the per-track id (not the ordinal, and not project/year) means
re-organizing the *site* — or adding/removing/reordering a track — never requires re-uploading
or moving objects in the bucket. Grouping is a view concern; keys are an identity concern —
they aren't coupled. (See `09-ingest-and-deploy.md` for the key scheme + the one-time migration.)

---

## 5.1 Storage origin switch (env-driven)

Which origin the site actually serves from is **one centralized switch**, not a code
change. All of it lives in `.env.production` (template `.env.production.example`):

| Var | Values | Role |
|---|---|---|
| `STORAGE_MODE` | `local` \| `remote` | local = serve from `public/` (no cloud); remote = object storage |
| `STORAGE_PRIMARY` | `r2` \| `rustfs` | the active origin (the switch) |
| `STORAGE_MIRROR` | `none` \| `r2` \| `rustfs` | dual-write a 2nd copy on ingest |
| `STREAM_FALLBACK_ENABLED` | `true` \| `false` | auto fail over to the other origin on a fetch error |

Both the **ingest** (where it uploads) and the **player/report loader** (where it
fetches) read these. Identical S3 keys are used on both origins, so switching is just
"point at the other endpoint." The switch is operated by `scripts/catalog-set-origin.sh`
(and the `catalog-operator` opencode agent — doc 08), never by hand-editing in the
common case. Per-origin credentials + URLs (`R2_*`, `PUBLIC_R2_*`, `RUSTFS_*`,
`PUBLIC_RUSTFS_*`) sit in the same file; only `PUBLIC_*` reach the browser. Design
details: [`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md).

---

## 6. Repo layout (target, additions in **bold**)

```
lufs-catalog-website/
├── astro.config.mjs            output: 'static'
├── src/
│   ├── content/{config.ts, releases/*.md}
│   ├── layouts/  pages/  components/{player/*}  styles/  tests/
│   └── scripts/ingest/
│       ├── catalog-ingest-local.mjs        (existing)
│       ├── utils.mjs                        (existing)
│       ├── **classify.mjs**                 (new: source-shape detection)
│       ├── **parseContext.mjs**             (new: context.json + HTML fallback)
│       ├── **transcode.mjs**                (new: ffmpeg WAV→MP3 + ffprobe duration)
│       ├── **uploadR2.mjs**                 (new: S3 PutObject; + commented rustfs mirror)
│       └── **generateMarkdown.mjs**         (new: edit-preserving merge)
├── public/{covers/, reports/}              small text + art only (committed)
├── **worker/**                              standalone signing Worker
│   ├── src/index.ts   wrangler.toml   package.json
├── **catalog-deploy.sh**                    build → push → hostinger split
├── .env.local.example   **.env.production.example**
└── docs/{PRD.md, TDD.md, **implementation/** (this suite)}
```

---

## 7. Trust & secret boundaries

- **Browser bundle** may only see `PUBLIC_*` vars (site URL, worker URL, public R2
  base). Never R2 keys.
- **Ingest scripts / `.env`** hold R2 credentials + `CATALOG_SOURCE_PATH`. Gitignored.
- **Worker** holds R2 credentials as Worker secrets (set via `wrangler secret put` or
  the dashboard), never in `wrangler.toml`.
- **Repo** holds only small reports + cover art. Large WAV/MP3/render-stats stay in
  R2 (and the NAS archive).
