# LUFS Catalog — Implementation Docs

This folder is the working reference for getting **catalog.lufs.audio** into a
live, maintainable state and wiring a repeatable pipeline from the
`lufs-workchain` **astro-catalog** output to published, streamable catalog
entries — on the LUFS brand design language.

It complements (does not replace) the two existing design docs one level up:

- [`../PRD.md`](../PRD.md) — product requirements (what the site is and does)
- [`../TDD.md`](../TDD.md) — technical design (the production architecture)

Those describe the *intended* system. The docs here describe **where we
actually are**, **where we're going**, **why**, and **how** — including a
from-scratch guide to CDNs and S3 for the first-time user, and the NAS
fallback design.

---

## Reading order

| # | Doc | What it answers |
|---|-----|-----------------|
| 1 | [`01-implementation-plan.md`](./01-implementation-plan.md) | The phased plan, who does what, acceptance criteria, sequencing |
| 2 | [`02-observed-state.md`](./02-observed-state.md) | What exists today, what works, what's stubbed, the source-shape taxonomy |
| 3 | [`03-desired-state.md`](./03-desired-state.md) | The target end state and success criteria |
| 4 | [`04-design-philosophy.md`](./04-design-philosophy.md) | The reasoning and principles behind every major choice |
| 5 | [`05-architecture.md`](./05-architecture.md) | Local vs production architecture, data flow, content model, organization scheme |
| 6 | [`06-cdn-and-s3-guide.md`](./06-cdn-and-s3-guide.md) | **Start here if you're new to S3/CDN.** Object storage, the S3 API, CDNs, egress, presigned URLs, CORS, and exact R2 setup steps |
| 7 | [`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md) | The NAS rustfs origin: the deliberate R2↔rustfs switch + automatic fallback, and how to wire it in (kept commented until the endpoint is live) |
| 8 | [`08-opencode-agent.md`](./08-opencode-agent.md) | The `catalog-operator` opencode agent (`.opencode/agents/`) that runs the site in natural language, + its helper scripts and the `.env` storage switch |

---

## Status legend

Throughout these docs:

- ✅ **Built** — exists and works in the repo today
- 🟡 **Partial** — exists but incomplete or stubbed
- ⛔ **Spec-only** — designed in PRD/TDD but not yet implemented
- 🔜 **Planned** — scheduled in the implementation plan

---

## TL;DR

- The **site** is in good shape: Astro v5 (static) + Svelte 5 + Howler.js, with a
  persistent bottom player that survives navigation. ✅
- The **local ingest** works for the *Continuo* album shape and copies assets into
  `public/`. 🟡 (one shape only)
- The **production path** (Cloudflare R2 + a signing Worker + Hostinger
  auto-deploy) is fully designed but **the cloud upload, the Worker, and the
  deploy script were never built**. ⛔
- The **new astro-catalog output** (the `3434` example) is **not yet ingestible**:
  different folder shape, ships `context.json` instead of the old report, and is
  **WAV-only (no web MP3)**, so a transcode step is required. ⛔
- **Decision:** Cloudflare R2 (bucket **`lufs-catalog`**, zero-egress, cheap for
  mostly-parked audio) as the primary CDN; **Hostinger** for site hosting; a **NAS
  rustfs S3 endpoint** as both a one-switch alternate origin (`STORAGE_PRIMARY=rustfs`)
  and an automatic fallback — implemented but commented until it's stood up.
- A **`catalog-operator` opencode agent** runs the whole thing in natural language.

---

## Clarifications & corrections (supersede PRD.md / TDD.md where they differ)

- **R2 bucket name is `lufs-catalog`** (not `lufs-audio` as written in PRD/TDD) —
  scoped to this use case.
- **Every top-level folder under `catalogs/` is an album** (`a98ff_praise-legend-road`,
  `footlights`, `3434`, …) — some are workchain-processed, some are raw and awaiting
  processing. See `02-observed-state.md` §4.
- **Storage is a centralized switch** (`STORAGE_PRIMARY=r2|rustfs` in
  `.env.production`), operated by `scripts/catalog-set-origin.sh` / the opencode
  agent — not a code change. See `06` §11 and `07`.
- **R2 pricing** is spelled out precisely in `06-cdn-and-s3-guide.md` §6 (short
  version: storage above 10 GB costs cents; uploads and streaming are effectively
  free; **egress is always \$0**).

---

## A note on who runs what

The audio archive lives on a NAS at `/Volumes/project/continuo/catalogs`, and the
`lufs-workchain` (REAPER-based) runs on Daniel's Mac. An agent/CI cannot reach the
NAS or run REAPER. So the division of labor is:

- **Agent builds & tests** all the code (ingest rewrite, transcode, R2 upload,
  Worker, deploy script, brand pass) and validates it against a small **sample**
  of astro-catalog output.
- **Daniel runs** the workchain and the real ingest locally, and performs the
  account/DNS/credential steps (or delegates them with scoped credentials).

_Last updated: 2026-06-10._
