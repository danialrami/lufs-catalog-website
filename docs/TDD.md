# TDD — LUFS Audio Catalog Website
**Document version:** 0.3 — 2026-02-22

***

## 1. Architecture Overview (Remote Production)

```
┌──────────────────────────────────────────────────────┐
│  Developer Machine                                   │
│  $CATALOG_SOURCE_PATH = /Volumes/project/continuo/   │
│                                                      │
│  catalog-ingest.mjs  ──reads──►  workchain output   │
│       │                                              │
│       ├── writes ──► src/content/releases/*.md       │
│       ├── copies ──► public/covers/, public/reports/ │
│       └── uploads ─► Cloudflare R2 (audio + reports)│
│                                                      │
│  catalog-deploy.sh                                   │
│       ├── pnpm build  ──► dist/                      │
│       ├── git push origin main                       │
│       └── git subtree split dist → hostinger branch  │
└───────────────────────────┬──────────────────────────┘
                            │ git push (hostinger branch)
             ┌──────────────▼──────────────┐
             │  GitHub Repository           │
             │  branch: hostinger           │
             └──────────────┬──────────────┘
                            │ webhook
             ┌──────────────▼──────────────┐
             │  Hostinger (static hosting)  │
             │  public_html/ ← dist/        │
             │  catalog.lufs.audio          │
             └─────────────────────────────┘

  Browser ──fetch /stream?key=───► Cloudflare Worker
                                   (standalone deployment)
                                       │ getSignedUrl
                                   Cloudflare R2
                                   lufs-audio bucket
                                   releases/  (private)
                                   reports/   (public)
                                   artwork/   (public)
```

**Architecture rationale:** The Astro site is fully `output: 'static'` — no SSR needed on Hostinger. Audio protection comes from a **standalone Cloudflare Worker** (free tier, deployed independently via `wrangler deploy`) that signs R2 URLs on demand. The site calls this Worker from the client side. `dist/` is split from the main repo and pushed to a separate `hostinger` branch, which Hostinger's Git auto-deploy webhook watches — the same pattern as the existing Hugo blog. [dev](https://dev.to/bkanhu/auto-deployment-of-website-with-github-and-hostinger-563p)

***

## 1b. Local-Only Development Architecture

```
┌──────────────────────────────────────────────────────┐
│  Developer Machine (MacBook Pro)                     │
│  $CATALOG_SOURCE_PATH = /Volumes/project/continuo/   │
│                                                      │
│  catalog-ingest-local.mjs ──reads──► workchain      │
│       │                                              │
│       ├── writes ──► src/content/releases/*.md       │
│       ├── copies ──► public/audio/                   │
│       ├── copies ──► public/reports/                 │
│       └── copies ──► public/covers/                  │
│                                                      │
│  catalog-dev.sh                                      │
│       ├── pnpm catalog:ingest:local                  │
│       └── pnpm dev                                   │
│           └─► http://localhost:4321                  │
└───────────────────────────┬──────────────────────────┘
                            │ (serves from)           │
             ┌──────────────▼──────────────┐
             │  Browser                   │
             │  http://localhost:4321     │
             │  (serves dist/ statically) │
             └─────────────────────────────┘

  Browser ──fetch local path──► Astro dev/build
                                   public/audio/*.mp3
                                   public/reports/*.html
                                   (no external services)
```

**Local Architecture Rationale:**
- Astro runs in default SSG mode (`output: 'static'`) with no SSR needed
- Audio is served directly from `public/` without Cloudflare Worker or R2
- The ingest script reads from local workchain output at `/Volumes/project/continuo/catalogs`
- All assets (MP3, reports, covers) are copied into `public/` on ingest
- Player uses Howler.js in HTML5 mode with direct local URLs
- Code is structured to allow swapping `audioPath`/`renderStatsPath` for R2 URLs later
- Same source directory structure - no schema migration needed

### Local Development Flow:

1. **Ingest**: `pnpm catalog:ingest:local` walks `$CATALOG_SOURCE_PATH`, copies assets to `public/`
2. **Dev**: `pnpm dev` serves from memory at http://localhost:4321
3. **Build**: `pnpm build` creates static site in `dist/`
4. **Preview**: `pnpm preview` serves static build locally for testing

### Local URL Structure:

- Audio: `/audio/[collectionId]/[trackNumber]/[filename].mp3`
  - Example: `/audio/a98ff_praise-legend-road/1/11-01-22.2181-03-42.773.mp3`
- Final Report: `/reports/[collectionId]/[trackNumber]/final_report.html`
  - Example: `/reports/a98ff_praise-legend-road/1/final_report.html`
- Render Stats: `/reports/[collectionId]/[trackNumber]/render_stats.html`
  - Example: `/reports/a98ff_praise-legend-road/1/render_stats.html`
- Covers: `/covers/[collectionId]/[trackNumber]/artwork.png`

### Migration-Friendly Design:

All track objects expose URL fields that are already fully-qualified public paths:
- `audioPath: string` — can be `/audio/...` (local) or `https://pub-xxxx.r2.dev/...` (R2)
- `renderStatsPath?: string` — can be `/reports/...` or R2 public URL
- `finalReport: string` — can be `/reports/...` or R2 public URL

To migrate to remote storage, swap these string values before storing in content; no component code changes needed.

***

## 2. Tech Stack

```
┌──────────────────────────────────────────────────────┐
│  Developer Machine                                   │
│  $CATALOG_SOURCE_PATH = /Volumes/project/continuo/   │
│                                                      │
│  catalog-ingest.mjs  ──reads──►  workchain output   │
│       │                                              │
│       ├── writes ──► src/content/releases/*.md       │
│       ├── copies ──► public/covers/, public/reports/ │
│       └── uploads ─► Cloudflare R2 (audio + reports)│
│                                                      │
│  catalog-deploy.sh                                   │
│       ├── pnpm build  ──► dist/                      │
│       ├── git push origin main                       │
│       └── git subtree split dist → hostinger branch  │
└───────────────────────────┬──────────────────────────┘
                            │ git push (hostinger branch)
             ┌──────────────▼──────────────┐
             │  GitHub Repository           │
             │  branch: hostinger           │
             └──────────────┬──────────────┘
                            │ webhook
             ┌──────────────▼──────────────┐
             │  Hostinger (static hosting)  │
             │  public_html/ ← dist/        │
             │  catalog.lufs.audio          │
             └─────────────────────────────┘

  Browser ──fetch /stream?key=───► Cloudflare Worker
                                   (standalone deployment)
                                       │ getSignedUrl
                                   Cloudflare R2
                                   lufs-audio bucket
                                   releases/  (private)
                                   reports/   (public)
                                   artwork/   (public)
```

**Architecture rationale:** The Astro site is fully `output: 'static'` — no SSR needed on Hostinger. Audio protection comes from a **standalone Cloudflare Worker** (free tier, deployed independently via `wrangler deploy`) that signs R2 URLs on demand. The site calls this Worker from the client side. `dist/` is split from the main repo and pushed to a separate `hostinger` branch, which Hostinger's Git auto-deploy webhook watches — the same pattern as the existing Hugo blog. [dev](https://dev.to/bkanhu/auto-deployment-of-website-with-github-and-hostinger-563p)

***

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Astro v5, `output: 'static'` | Islands arch, Content Layer API, View Transitions, zero JS by default — no adapter needed for static  [docs.astro](https://docs.astro.build/en/guides/content-collections/) |
| UI island framework | Svelte | Lightweight reactive islands; ideal for the player bar's simple state |
| State (cross-island) | `nanostores` | Astro-recommended; survives `transition:persist` across View Transitions |
| Audio engine | Howler.js v2 | Cross-browser, HTML5 streaming mode, `seek()`, `on('end')`  [howlerjs](https://howlerjs.com) |
| Audio + report storage | Cloudflare R2 | Zero egress, S3-compatible API; `releases/` private, `reports/` + `artwork/` public |
| Stream signing | Standalone Cloudflare Worker | Free tier Worker (`wrangler deploy`, separate from site) generates 1h presigned R2 URLs; frontend calls via `STREAM_WORKER_URL` env var |
| Site hosting | Hostinger static (via Git auto-deploy) | Existing prepaid plan; GitHub webhook deploys `dist/` from `hostinger` branch  [dev](https://dev.to/bkanhu/auto-deployment-of-website-with-github-and-hostinger-563p) |
| Deploy scripting | Bash (modeled on `sync_obsidian-to-hugo.sh`) | Consistent with existing tooling  [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh) |
| Ingest scripting | Node.js ESM (`.mjs`) | Parses HTML reports with `node-html-parser`; uploads to R2 with `@aws-sdk/client-s3` |
| HTML report parsing | `node-html-parser` | Extracts catalog number, SHA256, saturation from `_final_report.html`  [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/a6fb8dfe-f7f9-4f47-a3f0-7564b1914535/11-01-22.2181-03-42.773_final_report.html) |
| Styling | CSS custom properties + scoped `<style>` | Brand token system in `:root`; no Tailwind/build step needed |
| Package manager | `pnpm` | Workspace support |

***

## 3. Project File Structure

```
catalog.lufs.audio/
├── .env                           # local only — gitignored
├── .env.example                   # committed template
├── astro.config.mjs               # output: 'static'
├── package.json
├── pnpm-workspace.yaml
│
├── catalog-deploy.sh              # full deploy: [--ingest] → build → push → hostinger
│
├── src/
│   ├── content/
│   │   ├── config.ts              # Astro Content Layer schema
│   │   └── releases/
│   │       └── continuo.md        # one file per collection/release
│   │
│   ├── layouts/
│   │   └── BaseLayout.astro       # <html>, tokens, player mount, ViewTransitions
│   │
│   ├── pages/
│   │   ├── index.astro            # catalog grid (home)
│   │   └── releases/
│   │       └── [slug].astro       # release/collection detail (getStaticPaths)
│   │
│   ├── components/
│   │   ├── CatalogGrid.astro      # grid + legend filter
│   │   ├── ReleaseCard.astro      # single grid card
│   │   ├── TrackList.astro        # track rows on detail page
│   │   ├── WorkchainReport.astro  # sandboxed iframe for _final_report.html
│   │   ├── StreamingLinks.astro   # DSP link buttons
│   │   └── player/
│   │       ├── PlayerBar.svelte   # persistent bottom bar (client:only="svelte")
│   │       ├── playerStore.ts     # nanostores: currentTrack, queue, playState, seek
│   │       └── useHowler.ts       # Howler.js wrapper; fetches presigned URL first
│   │
│   ├── styles/
│   │   ├── tokens.css             # :root CSS custom properties
│   │   └── global.css             # reset + base typography
│   │
│   └── scripts/
│       └── ingest/
│           ├── catalog-ingest.mjs # CLI entry; walks CATALOG_SOURCE_PATH
│           ├── parseReports.mjs   # parses _final_report.html + render_stats.html
│           ├── generateMarkdown.mjs
│           └── uploadR2.mjs       # uploads MP3 + render_stats + artwork to R2
│
├── public/
│   ├── covers/                    # collection + track artwork (committed; small files)
│   └── reports/                   # _final_report.html files (committed; ~13KB each)
│
└── worker/                        # standalone Cloudflare Worker (separate deployment)
    ├── src/
    │   └── index.ts               # signs R2 URLs; CORS restricted to catalog.lufs.audio
    ├── wrangler.toml
    └── package.json
```

***

## 4. Content Schema (`src/content/config.ts`)

```typescript
import { defineCollection, z } from 'astro:content';

const trackSchema = z.object({
  trackNumber: z.number().int().positive(),
  displayTitle: z.string(),
  filename: z.string(),                    // base name without extension
  catalogNumber: z.string(),               // "lufs-[sha256-prefix8]"
  sha256: z.string().length(64),
  processedDate: z.coerce.date(),
  saturation: z.number().optional(),
  r2Key: z.string(),                       // private audio key in R2
  r2ReportKey: z.string().optional(),      // public render_stats key in R2
  duration: z.number().default(0),         // seconds; 0 if not yet parsed
  finalReport: z.string().optional(),      // path under public/reports/
  artwork: z.object({
    main: z.string().optional(),
    identicon: z.string().optional(),
    spectrogram: z.string().optional(),
    canvasStatic: z.string().optional(),
  }).optional(),
});

const releases = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    collectionId: z.string(),              // workchain dir: "[hash]_[bip39-words]"
    project: z.string(),                   // legend filter key
    artist: z.string().default('Daniel Ramirez'),
    releaseDate: z.coerce.date(),
    status: z.enum(['released', 'unreleased', 'draft']).default('released'),
    coverArt: z.string(),
    isrc: z.string().optional(),
    streamingLinks: z.object({
      spotify: z.string().url().optional(),
      appleMusic: z.string().url().optional(),
      bandcamp: z.string().url().optional(),
      soundcloud: z.string().url().optional(),
    }).optional(),
    tags: z.array(z.string()).default([]),
    tracks: z.array(trackSchema).default([]),
  }),
});

export const collections = { releases };
```

***

## 5. Ingest Script (`src/scripts/ingest/catalog-ingest.mjs`)

Run via `pnpm catalog:ingest` or triggered by `catalog-deploy.sh --ingest`.

### 5.1 Directory Walking Logic

```
CATALOG_SOURCE_PATH/
  [collection-dir]/          → one release entry
    [n]/                     → one track entry per numbered subdir
```

The script:
1. `readdirSync(CATALOG_SOURCE_PATH)` — skip `.DS_Store` and `organize_audio.sh`
2. For each collection directory, parse its name: `/^([a-f0-9]+)_(.+)$/` → `{ hashPrefix, bip39Slug }`
3. Check if `src/content/releases/[bip39Slug].md` already exists
   - If **new**: prompt for `title`, `releaseDate`, `isrc`, `status`
   - If **existing**: update the `tracks` array, preserve human-edited fields
4. For each numbered subdirectory:
   - Find `[filename]_final/[filename]_final_report.html` → call `parseReports.mjs`
   - Find `[filename].mp3` → upload to R2 at `releases/[collectionId]/[n]/[filename].mp3`
   - Find `[filename].render_stats.html` → upload to R2 at `reports/[collectionId]/[n]/render_stats.html`
   - Copy `_final/[filename]_final_report.html` → `public/reports/[collectionId]/[n]/final_report.html` (strip the "Download" anchor element first)
   - Copy artwork PNGs → `public/covers/[collectionId]/[n]/`
5. Call `generateMarkdown.mjs` to write/update the `.md` file

### 5.2 HTML Report Parsing (`parseReports.mjs`)

From `_final_report.html`: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/a6fb8dfe-f7f9-4f47-a3f0-7564b1914535/11-01-22.2181-03-42.773_final_report.html)

```javascript
import { parse } from 'node-html-parser';

export function parseFinalReport(html) {
  const root = parse(html);
  const text = root.text;

  const catalogNumber = text.match(/Catalog Number:\s*(lufs-[a-f0-9]+)/)?. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh);
  const sha256 = text.match(/Full SHA256 Hash:\s*([a-f0-9]{64})/)?. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh);
  const processedDate = text.match(/Processed:\s*(.+?)\n/)?. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh);
  const saturation = parseFloat(text.match(/Saturation:\s*([\d.]+)/)?. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh) ?? '0');
  const filename = text.match(/File:\s*(\S+\.wav)/)?. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh)?.replace('.wav', '');

  return { catalogNumber, sha256, processedDate, saturation, filename };
}

export function sanitizeFinalReport(html) {
  // Remove "Download" button/link so the embedded iframe has no download affordance
  const root = parse(html);
  root.querySelectorAll('a[download], button').forEach(el => el.remove());
  return root.toString();
}
```

From `render_stats.html` (REAPER export): extract duration and loudness data if parseable. Fall back to `ffprobe` for duration if the HTML structure is opaque:

```javascript
import { execSync } from 'child_process';

export function getAudioDuration(mp3Path) {
  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${mp3Path}"`
    ).toString();
    return Math.round(JSON.parse(output).streams[0]?.duration ?? 0);
  } catch {
    return 0;
  }
}
```

### 5.3 R2 Upload (`uploadR2.mjs`)

```javascript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(localPath, r2Key, contentType = 'audio/mpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: r2Key,
    Body: readFileSync(localPath),
    ContentType: contentType,
  }));
  console.log(`  ✓ Uploaded → ${r2Key}`);
}
```

Audio uploaded with `ContentType: 'audio/mpeg'`; render_stats uploaded with `ContentType: 'text/html'`; artwork with `ContentType: 'image/png'`.

***

## 6. Audio Streaming System

### 6.1 Standalone Cloudflare Worker (`worker/src/index.ts`)

Deployed independently with `pnpm worker:deploy` (runs `cd worker && wrangler deploy`). Accessible at the URL stored in `STREAM_WORKER_URL` env var (e.g., `https://stream.lufs.audio`). [developers.cloudflare](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS — only allow catalog.lufs.audio
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigin = env.ALLOWED_ORIGIN; // "https://catalog.lufs.audio"
    if (!origin.startsWith(allowedOrigin)) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    // Whitelist: only sign keys under releases/
    if (!key || !key.startsWith('releases/') || key.includes('..')) {
      return new Response('Forbidden', { status: 403 });
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      { expiresIn: 3600 }
    );

    return new Response(JSON.stringify({ url: signedUrl }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  },
};
```

### 6.2 Howler.js Player (`useHowler.ts`)

```typescript
import { Howl } from 'howler';

export async function createHowlFromR2Key(r2Key: string): Promise<Howl> {
  const streamWorkerUrl = import.meta.env.PUBLIC_STREAM_WORKER_URL;
  const res = await fetch(`${streamWorkerUrl}?key=${encodeURIComponent(r2Key)}`);
  const { url } = await res.json();

  return new Howl({
    src: [url],
    html5: true,   // streaming; does not buffer entire file
    format: ['mp3'],
    onend: () => import('./playerStore').then(m => m.playNext()),
  });
}
```

Progress scrub via `requestAnimationFrame` (avoids Howler's polling interval issues): [stackoverflow](https://stackoverflow.com/questions/37749258/how-can-i-update-a-progress-bar-with-howler-js)

```typescript
export function bindProgressLoop(howl: Howl, onTick: (seek: number) => void) {
  const tick = () => {
    if (howl.playing()) {
      onTick(howl.seek() as number);
      requestAnimationFrame(tick);
    }
  };
  howl.on('play', () => requestAnimationFrame(tick));
}
```

### 6.3 View Transitions + Persistent Player

```astro
<!-- src/layouts/BaseLayout.astro -->
<script>
  import { ViewTransitions } from 'astro:transitions';
</script>
<ViewTransitions />
<!-- Player mounts once; never re-mounts across navigation -->
<PlayerBar client:only="svelte" transition:persist />
```

`PlayerBar.svelte` uses `client:only="svelte"` so it never SSR-renders (avoids hydration mismatches) and `transition:persist` so Astro's View Transitions leave it untouched during page swaps. [docs.astro](https://docs.astro.build/en/guides/content-collections/)

***

## 7. Deploy Script (`catalog-deploy.sh`)

Directly modeled on `sync_obsidian-to-hugo.sh`: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/31731122/8736632a-ddcd-4197-a104-4e72e26df8b2/sync_obsidian-to-hugo.sh)

```bash
#!/bin/bash
# catalog-deploy.sh
# Usage: ./catalog-deploy.sh [--ingest]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load env file
set -a; source .env; set +a

# Required command check
for cmd in git pnpm node; do
  if ! command -v $cmd &> /dev/null; then
    echo "$cmd not found in PATH."
    exit 1
  fi
done

# Step 1: Init git if needed
if [ ! -d ".git" ]; then
  git init
  git remote add origin "$GITHUB_REPO"
else
  if ! git remote | grep -q 'origin'; then
    git remote add origin "$GITHUB_REPO"
  fi
fi

# Step 2: Optional ingest from workchain source
if [[ "${1:-}" == "--ingest" ]]; then
  echo "Running catalog ingest from $CATALOG_SOURCE_PATH..."
  pnpm catalog:ingest
fi

# Step 3: Build Astro site
echo "Building Astro site..."
if ! pnpm build; then
  echo "Astro build failed."
  exit 1
fi

# Step 4: Stage changes
if git diff --quiet && git diff --cached --quiet; then
  echo "No changes to stage."
else
  git add .
fi

# Step 5: Commit
commit_message="catalog update $(date +'%Y-%m-%d %H:%M:%S')"
if ! git diff --cached --quiet; then
  git commit -m "$commit_message"
fi

# Step 6: Push main branch
echo "Pushing to GitHub main..."
git push origin main

# Step 7: Subtree split dist/ → hostinger branch (same pattern as Hugo blog)
echo "Deploying dist/ to Hostinger..."
if git branch --list | grep -q 'hostinger-deploy'; then
  git branch -D hostinger-deploy
fi

if ! git subtree split --prefix dist -b hostinger-deploy; then
  echo "Subtree split failed."
  exit 1
fi

if ! git push origin hostinger-deploy:"${HOSTINGER_BRANCH:-hostinger}" --force; then
  echo "Push to hostinger branch failed."
  git branch -D hostinger-deploy
  exit 1
fi

git branch -D hostinger-deploy

echo "✓ Done. Catalog built and deployed to catalog.lufs.audio"
```

***

## 8. Environment Variables (`.env.example`)

```bash
# ─── Site ──────────────────────────────────────────────────────────────────────
PUBLIC_SITE_URL=https://catalog.lufs.audio
PUBLIC_PORTFOLIO_URL=https://portfolio.lufs.audio

# ─── Stream Worker ─────────────────────────────────────────────────────────────
# URL of the standalone Cloudflare Worker that signs R2 audio URLs
PUBLIC_STREAM_WORKER_URL=https://stream.lufs.audio

# ─── R2 Storage (server/script use only — never exposed to browser) ────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=lufs-audio
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev   # for public objects (reports, artwork)

# ─── Ingest ────────────────────────────────────────────────────────────────────
# Absolute path to the local workchain catalogs directory
CATALOG_SOURCE_PATH=/Volumes/project/continuo/catalogs

# ─── GitHub / Hostinger Deploy ─────────────────────────────────────────────────
GITHUB_REPO=https://github.com/danialrami/lufs-catalog.git
HOSTINGER_BRANCH=hostinger

# ─── Feature Flags ─────────────────────────────────────────────────────────────
SHOW_DRAFTS=false
```

`PUBLIC_` prefixed vars are safe for the browser bundle. All R2 credentials and path variables are server/script only — never import them in any Astro component or Svelte island. [docs.astro](https://docs.astro.build/en/guides/content-collections/)

***

## 9. R2 Bucket Configuration

Two access tiers within the same `lufs-audio` bucket:

| Prefix | Access | Purpose |
|---|---|---|
| `releases/` | **Private** | Audio MP3 files — presigned URLs only |
| `reports/` | **Public** | `render_stats.html` — embedded in `<iframe>` via direct URL |
| `artwork/` | **Public** (optional) | Track identicons, spectrograms if not committed to repo |

CORS policy (applied via R2 dashboard or `wrangler r2 bucket cors put`):
```json
[{
  "AllowedOrigins": ["https://catalog.lufs.audio"],
  "AllowedMethods": ["GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}]
```

***

## 10. CSS Design Tokens

```css
/* src/styles/tokens.css */
:root {
  --color-bg:         #111111;
  --color-surface:    #1a1a1a;
  --color-surface-2:  #242424;
  --color-text:       #fbf9e2;
  --color-text-muted: #E2E3D8;
  --color-teal:       #78BEBA;
  --color-red:        #D35233;
  --color-yellow:     #E7B225;
  --color-blue:       #2069AF;
  --color-border:     rgba(251, 249, 226, 0.08);

  --font-mono:  "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  --font-body:  "Host Grotesk", system-ui, sans-serif;

  --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;    --space-6: 1.5rem;  --space-8: 2rem;
  --space-12: 3rem;   --space-16: 4rem;

  --player-height: 72px;
  --radius-sm: 2px;   /* minimal rounding — retro/technical aesthetic */
  --radius-md: 4px;
}
```

***

## 11. Day-1 Milestone Checklist

- [ ] `pnpm create astro@latest` — `output: 'static'`, no adapter
- [ ] `pnpm astro add svelte`
- [ ] Create `.env` from `.env.example`; fill in all R2 + path values
- [ ] Create R2 bucket `lufs-audio`; configure CORS + public access for `reports/` prefix
- [ ] Deploy standalone Cloudflare Worker: `cd worker && wrangler deploy`
- [ ] Set `STREAM_WORKER_URL` + `ALLOWED_ORIGIN` in Worker env via Cloudflare dashboard
- [ ] Run `pnpm catalog:ingest` against `$CATALOG_SOURCE_PATH/a98ff_praise-legend-road/`
- [ ] Manually set `title: "Continuo"`, `releaseDate`, and `isrc` in `continuo.md`
- [ ] Define content schema in `src/content/config.ts`
- [ ] Build `PlayerBar.svelte` + `playerStore.ts` + `useHowler.ts`
- [ ] Wire `BaseLayout.astro` with `<ViewTransitions />` + `transition:persist`
- [ ] Build catalog grid + release detail page + `WorkchainReport.astro`
- [ ] Apply CSS tokens
- [ ] Connect Hostinger to GitHub repo, set auto-deploy webhook on `hostinger` branch [hostinger](https://www.hostinger.com/support/1583302-how-to-deploy-a-git-repository-in-hostinger/)
- [ ] Run `./catalog-deploy.sh` (no `--ingest`, since ingest ran manually first)
- [ ] Smoke test: stream plays, player persists, no R2 key in DOM, workchain report renders in iframe

***

***

## 12. Local-Only Development

For local development on MacBook Pro without Cloudflare R2, Workers, or Hostinger:

### Local Tech Stack (in addition to remote stack above)

| Layer | Choice | Rationale |
|---|---|---|
| Audio storage | Local filesystem (`public/`) | No R2 needed for local dev; assets copied to `public/audio/`, `public/reports/`, `public/covers/` |
| Audio streaming | Howler.js HTML5 mode | Direct local URLs via `audioPath`, no presigned URL worker required |
| Site serving | Astro dev/preview | HTTP server on localhost:4321; serve static from `dist/` |
| Deploy scripting | Bash (`catalog-dev.sh`) | Simpler workflow: ingest → dev; no git push to remote needed |

### Local Ingest Script Behavior

Run `pnpm catalog:ingest:local` (wrapped in `catalog-dev.sh`):

```
CATALOG_SOURCE_PATH/                    # Config: CATALOG_SOURCE_PATH env var (default: /Volumes/project/continuo/catalogs)
  [collectionId]/                       # e.g. a98ff_praise-legend-road
    artwork/YYYY-MM-DD_artwork.png      # → copied to public/covers/[collectionId]/artwork.png
    [trackNumber]/                      # e.g. "1", "2"
      [filename]_final/
        [filename]_final_report.html    # → copied to public/reports/[collectionId]/[trackNumber]/final_report.html (sanitized)
        artwork/...                     # → copied to public/covers/[collectionId]/[trackNumber]/
        audio/original/[filename].wav
        canvas/...
      [filename].render_stats.html      # → optional copy to public/reports/[collectionId]/[trackNumber]/
      [filename].wav
      [filename].mp3                    # → copied to public/audio/[collectionId]/[trackNumber]/[filename].mp3
```

For each track, the ingest script writes/updates `src/content/releases/[slug].md` with:
- `audioPath: "/audio/[collectionId]/[trackNumber]/[filename].mp3"` (local URL)
- `renderStatsPath: "/reports/[collectionId]/[trackNumber]/render_stats.html"` (local URL)
- `finalReport: "/reports/[collectionId]/[trackNumber]/final_report.html"` (local URL)

### Migration Path: Local → Cloud

All URL fields (`audioPath`, `renderStatsPath`, `finalReport`) are already abstracted as public URLs:
1. **Local dev**: Set to `/audio/...`, `/reports/...`
2. **R2 production**: Set to `https://pub-xxxx.r2.dev/releases/...`, `https://pub-xxxx.r2.dev/reports/...`

No component code needs to change—just the values stored in content files.

***

## 13. Key Decisions Log