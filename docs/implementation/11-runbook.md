# 11 — Runbook (publish a release)

The repeatable loop, once the one-time setup in [`/SETUP.md`](../../SETUP.md) is done.
All of this runs on Daniel's Mac (it needs the NAS + ffmpeg).

## Publish / update a release

1. **Process the audio.** Drop the finished track(s) into the album dir, then run
   `./scripts/catalog-process.sh --album <album-dir>` (or pass files). It runs the
   lufs-workchain `astro-catalog` chain per file and leaves a `{track-name}_astro-catalog/`
   dir per track, ready to ingest. (Or run the workchain yourself and name each output
   dir `{track-name}_astro-catalog`.)
2. **Deploy:**
   ```bash
   ./catalog-deploy.sh --ingest
   ```
   This ingests (transcode → MP3 320k, parse metadata; remote mode uploads audio to the
   private `lufs-catalog` bucket and covers/reports to the public `lufs-catalog-public`
   bucket; local mode copies into `public/`; writes `src/content/releases/<slug>.md`),
   validates the build, commits, and pushes `main`. **CI (`deploy.yml`) then builds and
   publishes `dist/` to the `hostinger` branch → Hostinger auto-deploys.** (Equivalently:
   `pnpm catalog:ingest`, then commit + push `main`, and let CI do the rest.)
3. **Fill in the human fields** in `src/content/releases/<slug>.md` (the ingest set
   safe defaults and preserves these on re-runs):
   - `title` (human-readable), `status: released` (new releases default to `draft`),
     `releaseDate`, `isrc`, `streamingLinks.*`, `tags`, `project`.
4. **Re-deploy** to publish the edits: `./catalog-deploy.sh` (no `--ingest` needed).

## Remove or replace a track / release

Keys are **stable per track** (`…/<collectionId>/<lufs-id>/…`), so a removal only orphans the
removed track's own objects — pair the source delete with a prune:
1. 🛑 Delete the track's `<track>_astro-catalog/` dir (or the whole album folder) from the source.
2. Preview: `R2_PRUNE=dry pnpm catalog:ingest` — regenerates the `.md` without the track and
   **lists** the orphaned R2 keys it would delete (just that track's `…/<lufs-id>/…`). Review.
3. Apply + ship: `R2_PRUNE=apply ./catalog-deploy.sh --ingest`. For a whole release, also delete
   `src/content/releases/<slug>.md` and add `R2_PRUNE_COLLECTIONS=<id>`.

Full add / remove / replace recipes (with the safety stops) live in the catalog-operator agent —
see [`08-opencode-agent.md`](./08-opencode-agent.md).

## Just preview locally (no deploy)

```bash
./catalog-dev.sh --ingest      # ingest + dev server at http://localhost:4321
# or: pnpm catalog:ingest && pnpm dev
```

## Switch the storage origin

```bash
./scripts/catalog-config.sh                 # show effective config (secrets masked)
./scripts/catalog-set-origin.sh rustfs      # serve from the NAS (once it's stood up)
./scripts/catalog-set-origin.sh r2          # back to Cloudflare
```
Then redeploy.

## Natural-language alternative (opencode)

In the repo: open `opencode` and talk to the **catalog-operator** agent — "update the
site with the audio I just added", "switch production to rustfs", "what's the current
config?", "deploy". It maps to the same scripts with hard-stops on destructive steps.
See [`08-opencode-agent.md`](./08-opencode-agent.md).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `CATALOG_SOURCE_PATH not found` | NAS not mounted. Mount `/Volumes/project/continuo/catalogs`. |
| `ffprobe`/`ffmpeg` errors | Not on PATH. `brew install ffmpeg`. |
| Album shows as "skipped (raw)" | Tracks not workchain-processed yet — run the astro-catalog chain first. |
| Remote ingest: "uploader unavailable" | `pnpm install` (needs `@aws-sdk/client-s3`); check `R2_*` in `.env.production`. |
| Audio won't play in prod | Worker not deployed / `PUBLIC_R2_STREAM_URL` unset / Origin not allow-listed in `wrangler.toml`. |
| Release won't appear publicly | `status` is `draft`/`unreleased`. Set `released` (or `PUBLIC_SHOW_DRAFTS=true` locally). |
| Build fails on a release | A bad/edited `.md` — check YAML against `src/content/config.ts`. |
