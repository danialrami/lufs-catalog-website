# SETUP — your steps (catalog.lufs.audio)

This is the human checklist: the things only you can do (installs, accounts, DNS,
secrets, running the workchain). The agent built and tested everything it could in a
sandbox, but **could not run `pnpm build`/`pnpm install` there** (the npm registry is
blocked) and **cannot reach the NAS or run REAPER** — so those steps are yours.

Deep-dives live in [`docs/implementation/`](docs/implementation/) — especially the
from-scratch CDN/S3 guide (`06`), the storage/streaming build (`09`), and the runbook
(`11`). Work top-to-bottom; you can stop after Phase A for a working *local* preview.

Legend: 🟢 do once · 🔁 per release · ⏳ later/optional

---

## Phase A — Local: get it building & previewing 🟢

1. **Install prerequisites** (Mac): Node 20+, `pnpm`, `git`, and **ffmpeg/ffprobe**
   (`brew install ffmpeg` — the ingest transcodes WAV→MP3 and reads duration).
2. **Install deps** (a new dependency, `@aws-sdk/client-s3`, was added):
   ```bash
   pnpm install
   chmod +x catalog-*.sh scripts/*.sh        # GitHub commits files non-executable
   ```
3. **Env file:** `cp .env.local.example .env.local` (defaults are fine; `STORAGE_MODE=local`).
4. **Mount the NAS** so `/Volumes/project/continuo/catalogs` exists.
5. **Verify the build + a real ingest** against an astro-catalog album (e.g. `3434`):
   ```bash
   pnpm build                 # ⚠ please confirm this succeeds — agent couldn't run it
   ./catalog-dev.sh --ingest  # ingest + dev server → http://localhost:4321
   ```
   Check: grid renders, a track plays, the player persists across navigation, the
   release page shows loudness + the embedded report. New releases come in as
   `status: draft` — set `released` in `src/content/releases/<slug>.md` (or
   `PUBLIC_SHOW_DRAFTS=true` to preview drafts).

> **Fast first live URL (optional):** staying in `STORAGE_MODE=local` commits the
> small *Continuo*/single MP3s into `public/` and deploys a fully static site with no
> Cloudflare at all. Good for a quick public URL; migrate to R2 (Phase B) when ready.

---

## Phase B — Cloudflare R2 (protected audio) 🟢

Full walkthrough + the "what is S3/CDN" primer: `docs/implementation/06-cdn-and-s3-guide.md`.

1. **Create the buckets:** Cloudflare → R2 → **Create bucket**:
   - **`lufs-catalog`** — keep it **private** (do *not* enable a public URL; audio is signed).
   - **`lufs-catalog-public`** — **public**: enable the public URL and map a custom domain
     **`cdn.lufsaud.io`**. Holds cover art + the proof-of-work report (incl. canvas video);
     audio never goes here. (Skip this bucket and the ingest falls back to committing
     covers/reports under `public/` — fine for a quick start.)
2. **API token:** R2 → *Manage R2 API Tokens* → **Object Read & Write**, scoped to
   `lufs-catalog`. Save the **Access Key ID**, **Secret Access Key**, and your
   **Account ID** / endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Deploy the signing Worker:**
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler secret put R2_ACCOUNT_ID
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler deploy
   ```
   Then in the dashboard map a route / custom domain → **`stream.lufsaud.io`**.
   (Confirm `ALLOWED_ORIGIN`/`R2_BUCKET_NAME` in `worker/wrangler.toml`.)
4. **Production env:** `cp .env.production.example .env.production` and fill
   `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT`, set
   `PUBLIC_R2_STREAM_URL=https://stream.lufsaud.io`, `R2_PUBLIC_BUCKET_NAME=lufs-catalog-public`
   + `PUBLIC_R2_BASE_URL=https://cdn.lufsaud.io` (both required to serve covers/reports from the
   CDN; the ingest then drops the local copies), and `STORAGE_MODE=remote`.
   *(CORS: the Worker already sends CORS headers; HTML5 `<audio>` playback of the
   signed URL doesn't need bucket CORS. If you ever switch the player to Web Audio,
   add a GET CORS rule on the bucket for your site origin.)*

---

## Phase C — Hosting + DNS 🟢

1. **DNS:** point `catalog.lufs.audio` → Hostinger; `stream.lufsaud.io` → the Worker.
2. **Hostinger Git auto-deploy:** connect this repo and set the auto-deploy webhook to
   watch the **`hostinger`** branch (same as your Hugo blog). The branch must contain
   **built output** (Hostinger doesn't run `astro build`) — **CI produces it**:
   - The workflow lives at `.github/workflows/deploy.yml` (template + rationale:
     `docs/implementation/ci-deploy.yml`). On every push to `main` it builds and publishes
     `dist/` to `hostinger`; Hostinger fast-forwards that into `public_html`. It must NOT use
     `force_orphan` (that rewrites `hostinger` as an orphan and breaks Hostinger's pull on
     "divergent branches"). Fresh clone? Copy the template into place once — the PR bot can't
     commit workflow files itself:
     ```bash
     mkdir -p .github/workflows && cp docs/implementation/ci-deploy.yml .github/workflows/deploy.yml
     git add .github/workflows/deploy.yml && git commit -m "ci: deploy to hostinger" && git push
     ```
   - Set repo **Variables** `PUBLIC_R2_STREAM_URL` + `PUBLIC_SITE_URL` (Settings → Secrets and
     variables → Actions → Variables); the workflow also falls back to the production values, so
     audio can't silently break on a missing var. A blank/local-mode build needs no secrets —
     good for confirming DNS + the webhook before any audio exists.
   - **Local convenience:** `./catalog-deploy.sh [--ingest]` ingests (optional), validates the
     build, commits, and pushes `main` — CI does the actual publish. (See `docs/implementation/09`
     §2–§3.)

---

## Phase D — Publish a release 🔁

(Full loop + troubleshooting: `docs/implementation/11-runbook.md`; this round's
hardening: `docs/implementation/12-hardening-and-verification.md`.)

1. Run the **workchain** (`astro-catalog` chain) on the finished audio. The output
   dir must be named **`{track-name}_astro-catalog/`** and sit in the album root,
   alongside the source audio — so an album holds one such dir per track:
   `…/catalogs/{album}/{track-name}_astro-catalog/` (a single like `3434` just has
   one). The helper does this for you and is the easiest path:
   ```bash
   ./scripts/catalog-process.sh --all        # every album under $CATALOG_SOURCE_PATH
   #   or: --album <album-dir>   |   <audio-file>...   |   --force to reprocess
   ```
   It runs the chain **with `--report`**, names each output `{track-name}_astro-catalog/`,
   and **skips tracks that are already complete** (needs the `lufs-workchain` CLI on PATH).
2. **Sanity-check the batch** (catches any incomplete/failed/report-less track):
   ```bash
   bash <lufs-workchain>/tests/verify_astro_catalog.sh "$CATALOG_SOURCE_PATH"
   #   add --rerun to re-process anything unfinished (also with --report)
   ```
3. `./catalog-deploy.sh --ingest` → ingests (transcode + upload audio to private R2 +
   covers/reports to the public bucket + write `.md`), validates the build, commits, and
   pushes `main`; **CI then builds + publishes to `hostinger` → auto-deploys.** (Or just
   `pnpm catalog:ingest`, commit to `main`, and let CI do the rest.)
4. Edit `src/content/releases/<slug>.md`: set `title`, `status: released`,
   `releaseDate`, `isrc`, `streamingLinks`, `tags`, `project` (these are preserved on
   re-ingest).
5. **Smoke test:** plays in prod, **no R2 key in page source**, report embeds, player
   persists.

---

## Phase E — Later / optional ⏳

- **NAS rustfs fallback / switch.** When you stand up rustfs + a (non-Cloudflare)
  TLS reverse proxy, follow `docs/implementation/07-nas-rustfs-fallback.md`: fill the
  `RUSTFS_*` vars, uncomment the dual-write/failover stubs, then
  `./scripts/catalog-set-origin.sh rustfs` to serve from the NAS.
- **opencode operator.** In the repo, `opencode` exposes the **catalog-operator**
  agent for natural-language ops ("update the site with the new audio", "switch to
  rustfs", "deploy"). See `docs/implementation/08-opencode-agent.md`.
- **Build-check CI** (optional, no secrets): `docs/implementation/09` §3.
- **Google Drive:** you can set the `3434.zip` sample back to *Restricted* now.

---

## ⚠️ Please verify (the agent couldn't fully, in-sandbox)

1. **`pnpm build` succeeds** with the full app (player + brand). The ingest→content→
   `astro build` *contract* was verified in-sandbox against generated content
   (incl. empty-hash and report-less edge cases) and a zero-release blank build —
   see `docs/implementation/12-hardening-and-verification.md` — but the agent did not
   build the full real app, so confirm the whole `pnpm build` once.
2. **Local audio playback** still works (preserved by design; the player edit is the
   one frontend change worth eyeballing).
3. **Remote streaming** once R2 + Worker are live: a track plays and the page contains
   no durable R2 URL/key.
4. **Brand pass** renders (fonts load, legend filters, report embed shows, reduced-motion respected).
5. **`catalog.spec.ts`** (Playwright e2e) still references the old `Continuo` fixture;
   update it to a current release once the real catalog is ingested.

If any of these trip, paste the error here and I'll fix it.
