# 01 — Implementation Plan

**Goal:** a live, maintainable `catalog.lufs.audio`, plus a repeatable pipeline
that turns `lufs-workchain` astro-catalog output into published, streamable
catalog entries on the LUFS brand.

**Strategy:** front-load a working URL, then layer in real storage, then the
real pipeline, then brand polish, then a runbook. Each phase ends with something
verifiable.

Status keys: ✅ built · 🟡 partial · ⛔ spec-only · 🔜 planned

---

## Ownership model

| Who | Does |
|-----|------|
| **Agent** | Writes/tests all code & docs; verifies the build in a sandbox; validates the pipeline against a sample; prepares exact, copy-pasteable steps for anything it can't do directly. Can perform cloud actions **if** given scoped credentials (e.g. a Cloudflare API token via a skill). |
| **Daniel** | Runs the workchain + real ingest locally (NAS access); creates the Cloudflare account/bucket/token; points DNS; sets the Hostinger webhook; later stands up rustfs + reverse proxy. |

---

## Phase 0 — Decisions, docs, and access  🔜 (in progress)

**Objective:** lock the foundational choices and capture them so we can always
come back.

- [x] Stack decision: **R2 (bucket `lufs-catalog`) + Hostinger** primary; **NAS rustfs** as a switchable origin + fallback (commented until stood up).
- [x] **This docs suite** under `docs/implementation/`, delivered via PR.
- [x] Define the **`catalog-operator` opencode agent** (`.opencode/agents/`) + helper scripts (`scripts/catalog-config.sh`, `scripts/catalog-set-origin.sh`) + `.env.production.example` (centralized storage switch). See [`08-opencode-agent.md`](./08-opencode-agent.md).
- [ ] Confirm the run-split (agent builds/tests; Daniel runs locally).
- [ ] Sort **repo access** for sandbox build verification (fine-grained PAT, or agent reconstructs from the API).
- [ ] Obtain a **sample astro-catalog output** (the `3434` shape) to design/test against.

**Acceptance:** decisions recorded; docs merged; a sample in hand; build access sorted.

---

## Phase 1 — Get a working site live

**Objective:** a real, browsable URL as fast as possible, using what already works
(the *Continuo* album).

- [ ] Clone the repo into the sandbox, `npm install`, and run `npm run build`; capture any errors.
- [ ] Fix build/schema issues; keep the existing `continuo.md` example rendering.
- [ ] Choose an **interim asset strategy**:
  - **Option A (fastest):** commit the small *Continuo* MP3 set into `public/` and deploy a fully static site — no R2 yet. Clearly interim; reverts once R2 is live.
  - **Option B:** skip straight to R2 (do Phase 2 first). Cleaner but slower to "live".
  - _Recommendation:_ A, to get a URL up within Phase 1, then migrate in Phase 2.
- [ ] Deploy (Hostinger or a preview host) and point `catalog.lufs.audio`.
- [ ] Smoke test: grid renders, detail page renders, player plays and **persists** across navigation.

**Acceptance:** `catalog.lufs.audio` (or a staging URL) loads, plays audio, and the
player survives navigation.

---

## Phase 2 — Storage and protected streaming

**Objective:** move audio to the CDN and stream it without exposing a permanent
URL or a download affordance.

- [ ] Create R2 bucket `lufs-catalog` with prefixes: `releases/` (private),
      `reports/` (public), `artwork/` (public). Apply CORS for `https://catalog.lufs.audio`.
- [ ] Build `src/scripts/ingest/uploadR2.mjs` (S3 `PutObject` via `@aws-sdk/client-s3`); add it to the ingest flow behind `STORAGE_MODE`/`STORAGE_PRIMARY`.
- [ ] Wire the env-driven **R2 ↔ rustfs switch** end to end (ingest upload target + mirror, and the player/report origin selection) so `scripts/catalog-set-origin.sh` actually changes what production serves.
- [ ] Build & deploy the standalone **signing Worker** (`worker/`) that returns
      short-lived presigned `GET` URLs for `releases/` keys, CORS-restricted to the site.
- [ ] Wire `useHowler.ts` to fetch a presigned URL from `STREAM_WORKER_URL` before playback; verify **no R2 key appears in the DOM**.
- [ ] **NAS rustfs fallback (commented):** add dual-write upload + player/report
      failover behind a `FALLBACK_ENABLED` flag, all disabled until the endpoint exists. See [`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md).
- [ ] Migrate *Continuo* audio to R2; flip URL fields; confirm streaming end-to-end.

**Acceptance:** audio streams from R2 via signed URLs; the page contains no R2 key
and no download link; reports/artwork load from the public prefixes.

---

## Phase 3 — astro-catalog pipeline (the core goal)

**Objective:** one command turns a workchain astro-catalog export into a published
catalog entry.

- [ ] Get a real `context.json` (from the workchain repo's astro-catalog chain, or a sample export) to design against.
- [ ] Rewrite the ingest to recognize **three source shapes** (see [`02-observed-state.md`](./02-observed-state.md)):
      single-track astro-catalog (e.g. `3434/astro-catalog/`), multi-track album
      (e.g. `a98ff_praise-legend-road/<n>/…_final/`), and legacy single-track `_final/`.
- [ ] Parse `context.json` for metadata (catalog number, sha256, dates, loudness),
      falling back to the report HTML when absent.
- [ ] **Transcode WAV → MP3** (ffmpeg) — required because astro-catalog output has
      no web MP3 — and compute `duration` via `ffprobe`.
- [ ] Upload assets to R2 (and, when enabled, mirror to rustfs); write/merge the
      release `.md`, **preserving hand-edited fields** (title, ISRC, streaming links).
- [ ] Support organizing entries **by project / by year / flat** as a config option.
- [ ] Add `catalog-deploy.sh` (build → push `main` → subtree-split `dist/` → `hostinger` branch).
- [ ] Test the whole workchain → ingest → deploy path against the sample.

**Acceptance:** running ingest against the `3434` sample produces a correct release
`.md` + uploaded assets + a streamable entry, with no manual asset shuffling.

---

## Phase 4 — Brand and UX polish

**Objective:** make it unmistakably LUFS and pleasant to use.

- [ ] Apply the **LUFS Brand Design System**: tokens, Host Grotesk + Public Sans +
      Space Mono, dark-editorial components, single-accent (teal) discipline.
- [ ] Custom cursor + scroll-reveal **with the force-show fallback** + `prefers-reduced-motion`.
- [ ] Project/year filtering + legend on the grid.
- [ ] Responsiveness (820/760/680/540), accessibility, and consistency with the
      unified `lufs.audio` look from the sister thread.

**Acceptance:** visually on-brand, responsive, accessible; nothing stuck hidden for
no-JS; consistent with the rest of the LUFS web family.

---

## Phase 5 — Repeatable runbook and handoff

**Objective:** Daniel can publish a new release in minutes, from memory or a one-pager.

- [ ] `docs/implementation/08-runbook.md`: end-to-end steps (workchain → ingest → deploy), with troubleshooting.
- [ ] Update README / PRD / TDD and fill the TDD "Key Decisions Log".
- [ ] Optional: a GitHub Action; hooks for the future "drafts" + SoundCloud archive (v2).

**Acceptance:** a clean runbook exists; docs match reality; new-release publishing is a short, well-understood routine.

---

## Sequencing rationale

1. **Live first** because momentum matters and a working URL de-risks everything
   downstream (DNS, hosting, player behavior in the wild).
2. **Storage before the new pipeline** because the pipeline's upload step needs the
   bucket + Worker to exist.
3. **Pipeline before brand** because content correctness should be proven before we
   spend time on polish.
4. **Runbook last** so it documents what we actually built, not what we guessed.

## Known cross-cutting risks

- **No NAS/REAPER access from CI/agent** → Daniel runs the heavy steps; agent tests against samples.
- **`context.json` schema unknown until sampled** → Phase 3 starts with a sample; parser is written defensively with HTML fallback.
- **Secrets discipline** → R2 keys live only in `.env` (gitignored) and Worker secrets; never in the browser bundle or git.
- **Git weight** → large WAV/render-stats never committed; only small `final_report.html` + cover art live in the repo.
