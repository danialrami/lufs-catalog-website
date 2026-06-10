# 12 — Ingest/build hardening & verification (2026-06)

This round made the **ingest ↔ build** contract robust and defensive, fixed the
workchain-side cause of missing reports, and verified the whole loop against a
synthetic catalog (a real `astro build`, since the 15 GB NAS library can't be
processed off-machine). Everything below is implemented in this repo + a companion
`lufs-workchain` change.

## Why
A dry run over the real `catalogs/` (104 tracks across 14 albums) surfaced edge cases
that would have broken a production build or shipped dead links:

- **`tags: null` → build abort (catalog-wide).** The ingest wrote a bare `tags:`
  line for releases with no tags; YAML reads that as `null`, and
  `z.array().default([])` only fills `undefined` — so *every* freshly-ingested
  release failed `astro build` with *"tags: Expected array, received null"*.
- **Empty `sha256` → build abort (per release).** A track whose `catalog_info.txt`
  is missing/unreadable ingests with `sha256: ""`, which failed
  `z.string().length(64)`.
- **Missing reports → dead links.** The `astro-catalog` chain has **no reporting
  step**; `*_report.html` is only emitted when the chain runs with `--report`. The
  verify script's `--rerun` omitted `--report`, so re-run tracks completed *without*
  a report, yet the ingest still wrote a `finalReport` path → guaranteed 404.
- **One bad track aborted the whole ingest.** A corrupt/zero-byte normalized file
  made `ffmpeg` throw and killed the entire run.

## Changes — website (`lufs-catalog-website`)

**`src/content/config.ts` (schema, defensive):**
- `sha256: z.string().regex(/^[a-f0-9]{64}$/i).or(z.literal(''))` — a real 64-char
  hash when present, but an empty string degrades gracefully instead of failing the
  build.
- `tags` and `tracks`: `z.preprocess(v => v ?? [], …)` — tolerate YAML `null` from a
  bare key or hand-edit.
- `finalReport: z.string().default('')` — explicitly optional/empty.

**`src/scripts/ingest/catalog-ingest.mjs` (ingest, defensive):**
- Emits `tags: []` (never a bare `tags:`).
- Sets `finalReport: ''` when no `*_report.html` exists (the release page already
  hides the link/iframe when empty).
- Per-track `try/catch`: a single failing track is skipped loudly; the run continues.
- Warns when an **album folder** name has URL-unsafe characters (it's used verbatim
  in `/audio|reports|covers/<id>/` paths; track names are slugified, album names are
  not).
- `main()` only runs when invoked directly, and pure helpers (`slugify`,
  `deriveIds`, `sanitizeReport`, `parseAstroCatalog`, `findAstroTracks`) are exported
  for unit tests.

**`scripts/catalog-process.sh` (the local "process new audio" helper, hardened):**
- Runs the chain **with `--report`** and writes straight to `{name}_astro-catalog/`
  via `-o` (no fragile post-hoc rename).
- **Completion-aware**: skips a track only when its `context.json` is genuinely
  `completed` (chain + every step); a stale/failed output dir is wiped and
  reprocessed. `--force` reprocesses regardless.
- New `--all [catalogs-root]` mode walks every album; `--album <dir>` and
  `<file>…` still work; `--verify-only` prints a completed/incomplete tally.
- Handles spaces/apostrophes/unicode in filenames; no `/dev/fd` dependency.

**CI deploy workflow (`docs/implementation/ci-deploy.yml` → copy to
`.github/workflows/deploy.yml`):** builds on push to `main` and publishes `dist/` to
the **`hostinger`** branch (force-orphan), so a push — including a zero-release
**blank** site — deploys via Hostinger's webhook **without a local build**. It ships
under `docs/implementation/` because the automation that opened this PR lacks GitHub's
`workflows` permission; activate it with one command:
```bash
mkdir -p .github/workflows && cp docs/implementation/ci-deploy.yml .github/workflows/deploy.yml
git add .github/workflows/deploy.yml && git commit -m "ci: build + deploy to hostinger" && git push
```
The manual `./catalog-deploy.sh` still works; both publish the same branch. No secrets
needed for a local-mode/blank build.

**`src/tests/ingest.test.ts` (new):** vitest unit tests for the exported helpers
(slug/special-char handling, verbatim `collectionId`, report sanitization).

**Removed:** the stale `src/content/releases/continuo.md` placeholder (superseded by
`a98ff_praise-legend-road` on ingest).

## Change — workchain (`lufs-workchain`, separate PR)
**`tests/verify_astro_catalog.sh`:**
- `--rerun` now runs the chain **with `--report`** so re-processed tracks keep their
  report.
- Dropped the hardcoded `3434` skip (it's a **real album** and was going unverified);
  skip list is now `SKIP_DIRS` (default `_utilities`), plus dot-dirs.
- Flags **completed-but-no-report** tracks (count in the summary).
- Reads the file list from a temp file (portable; no process-substitution `/dev/fd`).

## Verification (in-sandbox, real `astro build`)
A synthetic `catalogs/` reproduced every tricky shape: single + multi-track,
special-char names, `.mp3`/`.aiff` normals, a missing-report track, the `_final`
album, a `failed`-status track, and a missing-`catalog_info` track.
- Ran the **real** `catalog-ingest.mjs` → correct slugs, MP3 transcodes, verbatim
  `collectionId` paths, `failed` track skipped, `tags: []`, empty `finalReport` for
  the reportless track.
- Ran a **real `astro build`** against the generated releases: **passes** with the
  patched schema (incl. the empty-`sha256` release); the original schema **fails** on
  both `tags: null` and the empty hash — confirming the fixes are load-bearing.
- **Blank build** (zero releases) **passes** and renders an empty grid → a blank
  `catalog.lufs.audio` can deploy before any audio exists.
- `catalog-process.sh` process/skip/`--force`/`--verify-only` and the workchain
  verifier were exercised with a stub chain.

## What still runs on Daniel's Mac
Processing the real 15.5 GB library (REAPER + `uv` + the NAS + multi-hour compute)
runs locally — the sandbox can't hold or process it. The turnkey loop:

```bash
# 1) process everything that isn't already complete (with reports)
./scripts/catalog-process.sh --all                       # or: --album <dir> / <file>...
# 2) sanity-check the batch
bash <lufs-workchain>/tests/verify_astro_catalog.sh "$CATALOG_SOURCE_PATH"
# 3) ingest → build → preview
./catalog-dev.sh --ingest                                # http://localhost:4321
```
Then commit content to `main` and let CI deploy (or `./catalog-deploy.sh`).

> Note: `src/tests/catalog.spec.ts` (Playwright e2e) still asserts the old "Continuo"
> fixture; update it to a current release once the real catalog is ingested.
