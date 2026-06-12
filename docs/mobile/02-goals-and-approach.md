# 02 — Goals & approach

## Goal

Make **catalog.lufs.audio** look and work correctly on phones — fix the playbar,
make every page format for small screens — without disturbing the desktop
experience or the engine underneath.

## Scope (deliberately narrow)

**In scope:** CSS, markup, and `PlayerBar.svelte` component JS (the now-playing
sheet + touch input).

**Out of scope, on purpose:**
- The audio manager / single-voice Howler logic (`audioManager.ts`) — untouched.
- The content schema, ingest, R2/storage, signing Worker, and deploy — untouched.
- The desktop layout — unchanged; every change is gated behind a mobile breakpoint
  or is additive (e.g. the sheet is inert on desktop).

This keeps the PR reviewable and low-risk: if the brand pass in
[`../implementation/10-brand-and-ux.md`](../implementation/10-brand-and-ux.md) is the
"how it looks" layer, this is purely the "how it reflows and responds to touch"
layer on top.

## The three directions considered

For the mobile player specifically, three options were put to Daniel:

- **A — Compact faithful.** Keep the single-line fixed bar, just make it fit
  (artwork + title + play + a slim seek); add drag-to-scrub; keep skip; let the OS
  handle volume. Smallest change, closest to desktop.
- **B — Expandable now-playing sheet.** A slim collapsed bar that **taps up into a
  full-screen now-playing view** with large artwork and full transport. Most
  native-app feel, most work.
- **C — Two-tier compact.** The bar grows to two rows on phones (row 1: artwork +
  title + play; row 2: full-width seek + time). Everything visible, no hidden sheet.

## Decision

**Direction B — the now-playing sheet** — for the native-app feel, with **C as a
documented fallback** if the sheet proved impractical. The sheet was built and
verified working (see [`06`](./06-verification-and-screenshots.md)), so the fallback
was not needed.

## Principles carried through

- **Single-accent discipline.** Teal leads; gold is the seek-progress accent only.
  No new colors.
- **Restraint over decoration.** The sheet is mostly negative space around large
  artwork — quiet confidence, not chrome.
- **Motion is restrained and always safe.** The sheet slides up in `~0.3s`; every
  transition is disabled under `prefers-reduced-motion`, and nothing is ever left
  stuck hidden.
- **Honesty about capability.** The player has no real queue, so the sheet does not
  pretend to — its side transport buttons restart/seek-to-start rather than fake a
  next-track library. (A real previous/next is listed as a follow-up in
  [`06`](./06-verification-and-screenshots.md).)
- **Touch-first ergonomics.** Real drag scrubbing, ≥44px targets on the primary
  surfaces, `env(safe-area-inset-*)` so nothing hides under the iOS home indicator.
- **Verify visually.** "It built" is not "it's right" — the work was screenshotted
  at phone width and reviewed before the PR (see [`06`](./06-verification-and-screenshots.md)).
