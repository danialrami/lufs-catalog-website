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

1. **Create the bucket:** Cloudflare → R2 → **Create bucket** → name **`lufs-catalog`**
   (keep it **private** — do *not* enable a public URL on it; audio is signed).
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
   Then in the dashboard map a route / custom domain → **`stream.lufs.audio`**.
   (Confirm `ALLOWED_ORIGIN`/`R2_BUCKET_NAME` in `worker/wrangler.toml`.)
4. **Production env:** `cp .env.production.example .env.production` and fill
   `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT`, set
   `PUBLIC_R2_STREAM_URL=https://stream.lufs.audio`, and `STORAGE_MODE=remote`.
   *(CORS: the Worker already sends CORS headers; HTML5 `<audio>` playback of the
   signed URL doesn't need bucket CORS. If you ever switch the player to Web Audio,
   add a GET CORS rule on the bucket for your site origin.)*

---

## Phase C — Hosting + DNS 🟢

1. **DNS:** point `catalog.lufs.audio` → Hostinger; `stream.lufs.audio` → the Worker.
2. **Hostinger Git auto-deploy:** connect this repo and set the auto-deploy webhook to
   watch the **`hostinger`** branch (same as your Hugo blog). `catalog-deploy.sh`
   publishes built output there; Hostinger pulls it into `public_html`. (There is **no
   GitHub Actions CI** — see `docs/implementation/09` §3 for why and how to add a
   build-check later if you want one.)

---

## Phase D — Publish a release 🔁

(Full loop + troubleshooting: `docs/implementation/11-runbook.md`.)

1. Run the **workchain** (`astro-catalog` chain) on the finished audio. The output
   dir must be named **`{track-name}_astro-catalog/`** and sit in the album root,
   alongside the source audio — so an album holds one such dir per track:
   `…/catalogs/{album}/{track-name}_astro-catalog/` (a single like `3434` just has
   one). Albums with no `*_astro-catalog/` dir are skipped by the ingest.
2. `./catalog-deploy.sh --ingest` → ingests (transcode + upload to R2 + write `.md`),
   builds, pushes `main`, publishes `dist/` to `hostinger` → auto-deploys.
3. Edit `src/content/releases/<slug>.md`: set `title`, `status: released`,
   `releaseDate`, `isrc`, `streamingLinks`, `tags`, `project` (these are preserved on
   re-ingest).
4. `./catalog-deploy.sh` again to publish the edits.
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

## ⚠️ Please verify (the agent couldn't, in-sandbox)

1. **`pnpm build` succeeds** with the new `config.ts` (loudness field) + generated `.md`.
2. **Local audio playback** still works (preserved by design; the player edit is the
   one frontend change worth eyeballing).
3. **Remote streaming** once R2 + Worker are live: a track plays and the page contains
   no durable R2 URL/key.
4. **Brand pass** renders (fonts load, legend filters, report embed shows, reduced-motion respected).

If any of these trip, paste the error here and I'll fix it.
