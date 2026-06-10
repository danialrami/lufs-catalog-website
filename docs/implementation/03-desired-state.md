# 03 — Desired State

Where we want to land. This is the contract for "done."

---

## 1. The one-sentence target

> A new release goes from **finished audio** → **`lufs-workchain` astro-catalog
> export** → **one ingest command** → **live, streamable, on-brand catalog entry**
> at `catalog.lufs.audio`, with assets on a cheap CDN and a NAS fallback, and no
> manual asset shuffling.

---

## 2. End-state architecture (target)

- **Site:** Astro static, deployed to **Hostinger** via git auto-deploy (`dist/` →
  `hostinger` branch webhook), mirroring the existing Hugo blog workflow.
- **Storage/CDN:** **Cloudflare R2**, bucket `lufs-audio`:
  - `releases/` — **private** audio (MP3), served only via short-lived presigned URLs.
  - `reports/` — **public** `render_stats.html` (+ large report assets).
  - `artwork/` — **public** cover/identicon/spectrogram/canvas stills.
- **Streaming protection:** a standalone **Cloudflare Worker** signs `releases/`
  GETs on demand; the browser never sees a durable URL or an R2 key, and there's no
  download affordance.
- **Resilience fallback:** a **NAS rustfs S3 endpoint** mirrors the same keys; the
  ingest dual-writes and the player/report loader fails over to it if R2/Cloudflare
  is unavailable. **Implemented but disabled** until the endpoint is stood up.
- **Archive:** the NAS remains the canonical, full-fidelity archive (WAV, logs,
  everything) regardless of what the website serves.

---

## 3. The pipeline (target behavior)

`pnpm catalog:ingest` (and `./catalog-deploy.sh --ingest`) will:

1. Walk `CATALOG_SOURCE_PATH` and classify each entry by **source shape**
   (astro-catalog single-track / album / legacy `_final` / raw-skip).
2. Read **`context.json`** for metadata (HTML report as fallback).
3. **Transcode** the chosen master WAV → web MP3 (consistent bitrate), and compute
   **duration** via ffprobe.
4. **Upload** audio (private) + reports/artwork (public) to R2 — and, when enabled,
   mirror to rustfs.
5. **Write/merge** `src/content/releases/<slug>.md`, **preserving hand-edited
   fields** (human title, ISRC, streaming links, tags, status).
6. Place entries under a configurable **organization scheme** (by project / by year
   / flat).

Then `catalog-deploy.sh` builds and ships.

---

## 4. Content & catalog qualities

- **Organized** by project or year (configurable), with a grid **legend/filter**.
- **Proof-of-work** preserved per track: catalog number (`lufs-<hash8>`), full
  SHA256, processed date, loudness — shown in monospace; `final_report.html`
  embedded (sanitized) in a sandboxed iframe; `render_stats.html` linked.
- **Drafts/unreleased** supported via `status` + `SHOW_DRAFTS` (infra now, content later).
- **No downloads** of released audio.

---

## 5. Brand qualities

- LUFS dark-editorial system: `#111` ground, **teal `#78BEBA`** lead accent (single-
  accent discipline), Host Grotesk / Public Sans / Space Mono, hairlines, monospace
  data.
- Custom cursor + scroll-reveal **with force-show fallback** + `prefers-reduced-motion`.
- Visually consistent with the unified `lufs.audio` look.

---

## 6. Operability

- A **runbook** so publishing a release is a short, known routine.
- Secrets only in `.env` (gitignored) + Worker secrets; never in the bundle or git.
- Big files never committed; only small reports + cover art live in the repo.
- Costs predictable and low (see [`06-cdn-and-s3-guide.md`](./06-cdn-and-s3-guide.md)).

---

## 7. Explicit non-goals (v1)

- Programmatic DSP/DistroKid uploads.
- User accounts, comments, social.
- Download functionality for released tracks.
- A CMS UI (file + script driven).
- Migrating the SoundCloud / loose-archive material (v2 candidate).

---

## 8. Day-done success criteria

- `catalog.lufs.audio` is live; *Continuo* fully populated.
- Audio streams via the Worker; **no R2 key in the DOM**; no download link.
- Player persists across all navigation without interruption.
- Running ingest against a fresh astro-catalog export (the `3434` shape) yields a
  correct entry with zero manual asset moves.
- The grid + legend render; reports embed; catalog number + SHA256 show in monospace.
- The NAS fallback is present in code, documented, and ready to enable with a flag.
