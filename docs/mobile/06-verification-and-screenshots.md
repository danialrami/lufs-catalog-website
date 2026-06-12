# 06 — Verification & screenshots

How this change was verified in the sandbox before the PR, and what is left for
Daniel to confirm on a real device. Point-in-time record (2026-06-11).

## What ran, and the results

- **Build.** `PUBLIC_SHOW_DRAFTS=true pnpm build` against the sample content →
  **green, 15 pages** (1 index + 14 release pages). `PlayerBar` compiled clean
  (~60KB island).
- **Unit tests.** `pnpm test` (vitest) → **19/19 passing**, 2 files. The
  `playerStore` and ingest suites still pass — the player-store contract was not
  touched.
- **Svelte a11y.** Build emitted **zero a11y warnings** — the interactive `div`s
  (`role="slider"` / `role="button"`) have the keyboard handlers and ARIA the
  compiler requires. (The only build warnings are pre-existing `glob-loader`
  duplicate-id notices from the sample content, unrelated to this change.)
- **Screenshots.** Playwright (Chromium) drove the built site through `astro
  preview` at a **390×844** mobile viewport (plus 768px tablet and 1280px desktop),
  capturing: the homepage, the collapsed bar with a loaded track, the **expanded
  now-playing sheet**, a release page, and an open proof-of-work report. The script
  lives nowhere in the repo (it was a throwaway under a git-ignored `shots/`); the
  images were attached to the PR.

### Screenshot caveat — placeholder cover art

The sample release content points `coverArt` at `cdn.lufsaud.io`, which the sandbox
can't reach. For clean screenshots a **local placeholder cover** (a charcoal/teal
gradient with a waveform) was generated and the sample `coverArt` temporarily
repointed at it — **screenshot-only, reverted before commit, never pushed**. Judge
composition, not that specific art; in production the real CDN covers load. The
report iframe is blank in-sandbox for the same reason (its HTML is CDN-served) — the
*sizing* is what was verified.

## Independent review (two subagents)

1. **Build/QA pass** — re-ran a clean build + tests and code-reviewed the new
   `PlayerBar` JS: confirmed pass, zero a11y warnings, and **no bugs** in the
   pointer-capture handlers, the body-scroll-lock lifecycle, or the `class:open`
   toggle.
2. **Design/brand pass** — reviewed every screenshot against the LUFS brand and
   mobile-usability bar. Verdict: pages, tablet, and desktop solid and on-brand;
   flagged a few sheet refinements.

### Refinements made in response

- **Visible drag thumbs** added to the sheet seek (gold) and volume (teal) — the
  thin bars alone didn't read as grabbable.
- **An `▲` expand affordance** added to the collapsed bar so it's obviously tappable.
- **Tap targets** nudged up on the homepage chips and card play buttons.

(Several other flags were already handled and just not visible in headless captures:
the close button is already a 44px hit area; the sheet already has
`env(safe-area-inset-bottom)` padding; the panel is `#111`, not pure black; the gold
hairline only fills when there's playback progress.)

## What to re-check on a real device

In-sandbox verification can't exercise everything. On a real phone, confirm:

- **Drag-scrubbing** the seek and volume with a finger (Pointer Events + capture
  behave as designed, but real touch is the proof).
- **Real cover art** loading from the CDN in the bar and the sheet.
- **Safe-area** clearance on a notched device (home-indicator vs the bar and the
  sheet's bottom volume row).
- The **report iframe** rendering real report HTML at the new mobile heights.
- Sheet **open/close** across a few client-side navigations (the scroll-lock reset).

## Follow-ups (not in this change) 🔜

- A real **previous/next** track queue, so the sheet's side transport can do more
  than seek-to-start.
- An optional **swipe-down-to-dismiss** gesture on the sheet.
- A short Playwright **mobile smoke test** committed under `src/tests/` to guard the
  collapsed-bar → sheet flow in CI.
