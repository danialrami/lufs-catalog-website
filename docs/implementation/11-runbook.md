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
   This: ingests (transcode → MP3 320k, parse metadata, upload audio to R2 in remote
   mode / copy to `public/` in local mode, write `src/content/releases/<slug>.md`),
   builds, pushes `main`, and publishes `dist/` to the `hostinger` branch → Hostinger
   auto-deploys.
3. **Fill in the human fields** in `src/content/releases/<slug>.md` (the ingest set
   safe defaults and preserves these on re-runs):
   - `title` (human-readable), `status: released` (new releases default to `draft`),
     `releaseDate`, `isrc`, `streamingLinks.*`, `tags`, `project`.
4. **Re-deploy** to publish the edits: `./catalog-deploy.sh` (no `--ingest` needed).

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
