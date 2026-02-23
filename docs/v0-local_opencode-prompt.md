You are a senior TypeScript + Astro v5 + Svelte developer working in this repo:

- Root: `~/repos/lufs-catalog-website/`
- Docs:
  - `docs/PRD.md`
  - `docs/TDD.md`
  - `docs/references/example_for_reference_and_adaptation.sh`

Read `docs/PRD.md` and `docs/TDD.md` for the current product and technical definitions of the LUFS catalog site. Use them as authoritative references, but design a **local-only dev/deployment version** of the site with the following constraints:

- Everything runs entirely on my MacBook Pro.
- No Hostinger, no Cloudflare Pages, no Cloudflare R2, no Workers, no presigned URLs.
- Audio files and HTML reports are served directly from the local filesystem via Astro’s `public/` folder when I run `pnpm dev` or `pnpm build && pnpm preview`.
- The ingest logic still walks my workchain output directory at `/Volumes/project/continuo/catalogs`, using the exact directory schema described in `docs/PRD.md` / `docs/TDD.md`.
- The bottom playback bar still uses Howler.js and behaves like Spotify’s persistent player, but it reads from local URLs instead of signed R2 URLs.
- The codebase must remain structured so I can later swap local paths (`audioPath`, `renderStatsPath`) for remote/R2 URLs without rewriting all components.

Work directly in this repo: create or modify files under `src/`, `public/`, and add any necessary scripts at the project root.

***

## 1. Clarify the local architecture (in docs + code comments)

1. Add a short section to `docs/TDD.md` describing the **local-only dev architecture**, including:
   - Astro v5 in default SSG mode (static output).
   - A local ingest script that:
     - Reads from `/Volumes/project/continuo/catalogs`.
     - Copies (or symlinks, if you think it’s better) assets into:
       - `public/audio/`
       - `public/reports/`
       - `public/covers/`
     - Generates/updates Markdown content under `src/content/releases/`.
   - How the site is served locally:
     - `pnpm dev` → `http://localhost:4321` (or Astro’s default)
     - `pnpm build && pnpm preview` → static preview on localhost.
2. Explicitly describe how audio and reports are referenced in the UI using local paths:
   - Example audio:  
     `"/audio/a98ff_praise-legend-road/1/11-01-22.2181-03-42.773.mp3"`
   - Example final report:  
     `"/reports/a98ff_praise-legend-road/1/final_report.html"`

Keep this architectural description concise but concrete.

***

## 2. Adjust the content model for local use

Update or create `src/content/config.ts` using `astro:content`:

1. Start from the `releases` schema described in `docs/TDD.md`.
2. Replace any fields tied to R2/remote storage:
   - Remove `r2Key` and `r2ReportKey`.
   - Introduce:
     - `audioPath: string` — a public URL path under `/audio/...`.
     - `renderStatsPath?: string` — a public URL path under `/reports/...` (optional).
3. Keep:
   - `finalReport: string` — public path under `/reports/...`.
   - `artwork` object with public paths under `/covers/...`.

Deliverable:

- A complete `src/content/config.ts` file with the updated `releases` collection and `track` schema using `audioPath` and `renderStatsPath`.

***

## 3. Design and scaffold the local ingest script

Create a Node.js ESM script at `src/scripts/ingest/catalog-ingest-local.mjs`:

Behavior:

- Uses `CATALOG_SOURCE_PATH` env var (default `/Volumes/project/continuo/catalogs`) to find the workchain data.
- Walks the directory tree as described in `docs/PRD.md` / `docs/TDD.md`:

  ```text
  $CATALOG_SOURCE_PATH/
    [collectionId]/                    # e.g. a98ff_praise-legend-road
      artwork/YYYY-MM-DD_artwork.png
      [trackNumber]/                   # "1", "2", ...
        [filename]_final/
          [filename]_final_report.html
          artwork/...png
          audio/original/[filename].wav
          canvas/... (gif/mp4/png)
          catalog/catalog_info.txt
          logs/...
        [filename].render_stats.html
        [filename].wav
        [filename].mp3
  ```

For each collection & track:

- Read `_final_report.html`:
  - Parse:
    - workchain catalog number (`lufs-…`),
    - SHA256 hash,
    - processed date,
    - saturation.
- Get duration:
  - Either parse from `render_stats.html` or call `ffprobe` on the `.mp3`.
- Copy assets into `public/`:
  - MP3 → `public/audio/[collectionId]/[trackNumber]/[filename].mp3`
  - `_final_report.html` → `public/reports/[collectionId]/[trackNumber]/final_report.html`  
    (sanitize to remove any “Download” links/buttons)
  - Optional: `render_stats.html` → `public/reports/[collectionId]/[trackNumber]/render_stats.html`
  - Artwork PNGs → `public/covers/[collectionId]/[trackNumber]/...`
- Write/update `src/content/releases/[slug].md`:
  - One `.md` per collection (`slug` can be based on `collectionId` or manually supplied).
  - Update/add entries in the `tracks` array using **local paths**:
    - `audioPath: "/audio/[collectionId]/[trackNumber]/[filename].mp3"`
    - `renderStatsPath: "/reports/[collectionId]/[trackNumber]/render_stats.html"` (if copied)
    - `finalReport: "/reports/[collectionId]/[trackNumber]/final_report.html"`

If the release `.md` does not exist:

- Prompt via stdin (Node `readline`):
  - `title`
  - `releaseDate`
  - `isrc`
  - `project`
  - `tags` (comma-separated)
- Create a new file in `src/content/releases/`.

Implementation detail:

- Show the **high-level structure** of `catalog-ingest-local.mjs`:
  - `main()` function.
  - Helper functions:
    - `walkCollections()`
    - `processCollection()`
    - `processTrack()`
    - `parseFinalReport(html: string)`
    - `sanitizeFinalReport(html: string)`
    - `copyAsset(src, dest)`
    - `readOrCreateReleaseMarkdown()`, etc.
- Provide **actual code** for `parseFinalReport(html)` using `node-html-parser` that extracts:
  - `catalogNumber`
  - `sha256`
  - `processedDate`
  - `saturation`
  - `filename` (base without `.wav`)

You may create a small utility module (e.g., `src/scripts/ingest/utils.mjs`) if it helps.

***

## 4. Update the audio player integration for local paths

Adapt the player code to use `audioPath` (URL) directly:

1. Create or update `src/components/player/useHowler.ts` (or `.ts` in the same folder) with:

   - A function `createHowlFromUrl(audioPath: string): Howl` that:
     - Instantiates Howler with `src: [audioPath]`.
     - Uses `html5: true`.
     - Hooks `onend` into the player store’s `playNext()` function.

2. Update the player store and components to use `audioPath`:

   - The track object in the store should look like:

     ```ts
     {
       title: string;
       coverArt: string;
       audioPath: string;
       duration: number;
       releaseSlug: string;
       // plus catalogNumber, sha256, etc., as needed
     }
     ```

   - Show how a track from content (`tracks[]` in a release `.md`) is passed into the store when a user clicks “play”.

3. Keep the persistent player pattern:

   - `PlayerBar.svelte` as a Svelte island.
   - Mounted once in `src/layouts/BaseLayout.astro` with `transition:persist` and Astro View Transitions.
   - Confirm in code/comments that this works under `pnpm dev` without any extra config.

Provide the full `useHowler.ts` and any minimal adjustments to the player store type definitions to make `audioPath` the primary source.

***

## 5. Define a local `.env.local.example`

Create a new file at `.env.local.example` with a minimal, dev-only config:

- No cloud credentials at all.
- At least:

  ```bash
  CATALOG_SOURCE_PATH=/Volumes/project/continuo/catalogs
  PUBLIC_SITE_URL=http://localhost:4321
  SHOW_DRAFTS=true
  ```

Add comments explaining each variable.

***

## 6. Create a dev-only run script

At the repo root, create `catalog-dev.sh`:

Behavior:

- `set -euo pipefail`.
- Resolve the script directory and `cd` there.
- If `.env.local` exists, source it.
- Check for `pnpm` and `node` in `PATH` (similar style to `docs/references/example_for_reference_and_adaptation.sh`).
- Run:

  ```bash
  pnpm catalog:ingest:local
  pnpm dev
  ```

Add the corresponding script entry in `package.json`:

```json
"scripts": {
  "catalog:ingest:local": "node ./src/scripts/ingest/catalog-ingest-local.mjs",
  "dev": "astro dev",
  ...
}
```

Ensure `catalog-dev.sh` is executable (`chmod +x` is fine to mention in a comment).

***

## 7. Keep it migration-friendly

In your code and comments:

- Clearly mark any logic that is **local-only**:
  - Direct paths into `public/audio/`, `public/reports/`, `public/covers/`.
  - Any assumptions about `/Volumes/project/continuo/catalogs`.
- Keep the abstractions around “where does the audio URL come from?” and “where does the report URL come from?”:
  - For example, centralize track URL building in the ingest script, and treat `audioPath` / `renderStatsPath` / `finalReport` as opaque, already-resolved public URLs for the UI.
- Add brief comments where appropriate indicating how these fields could later be switched to R2/Hostinger URLs (e.g., swapping `audioPath` for a signed URL returned from an API).

***

## 8. Deliverables

Please implement and/or modify the following files in this repo:

1. `src/content/config.ts` — updated schema using `audioPath` and `renderStatsPath`.
2. One example release markdown file, e.g. `src/content/releases/continuo.md`, with frontmatter showing:
   - At least one track using the new `audioPath`, `renderStatsPath`, `finalReport`, and artwork paths.
3. `src/scripts/ingest/catalog-ingest-local.mjs` — with:
   - A clear `main()` entry point.
   - Directory walking.
   - `parseFinalReport(html)` implemented with `node-html-parser`.
   - Copying assets into `public/`.
   - Updating/creating release `.md` files.
4. `src/components/player/useHowler.ts` — refactored to `createHowlFromUrl(audioPath: string)`.
5. Any minimal updates to the player store/types and the components that wire tracks into the player.
6. `.env.local.example` — minimal, local-only env example.
7. `catalog-dev.sh` — dev helper script at repo root.
8. Any small changes needed in `astro.config.mjs` for this local-only version (for example, ensuring `output` is appropriate and paths resolve correctly).

Comment your code enough that I can follow the flow later, but prioritize clear, working implementations over long prose.