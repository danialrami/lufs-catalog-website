# LUFS Catalog — Mobile Support Docs

This folder documents the **mobile-support overhaul** of **catalog.lufs.audio** —
making the site look and work right on phones, where it previously didn't. The
desktop experience was already on-brand; this work brings the same care to small
screens and adds a native-app-style **now-playing sheet** for the audio player.

It complements (does not replace) the implementation suite one level up — in
particular [`../implementation/10-brand-and-ux.md`](../implementation/10-brand-and-ux.md)
(the original brand pass) and
[`../implementation/09-ingest-and-deploy.md`](../implementation/09-ingest-and-deploy.md)
(how the player resolver / streaming work). Nothing here touches ingest, schema,
storage, or deploy — it is a **surface-only** change (CSS, markup, and
player-component JS).

---

## Reading order

| # | Doc | What it answers |
|---|-----|-----------------|
| 1 | [`01-observed-state.md`](./01-observed-state.md) | What was wonky on mobile, file by file, and the breakpoint audit |
| 2 | [`02-goals-and-approach.md`](./02-goals-and-approach.md) | The goal, the surface-only scope, the three player directions, and why we chose the now-playing sheet |
| 3 | [`03-now-playing-sheet.md`](./03-now-playing-sheet.md) | The collapsed bar + full-screen sheet: markup, state, persistence, artwork, accessibility |
| 4 | [`04-touch-input-and-pointer-events.md`](./04-touch-input-and-pointer-events.md) | The root touch bug (mouse-only seek/volume) and the Pointer Events fix |
| 5 | [`05-responsive-layout-and-breakpoints.md`](./05-responsive-layout-and-breakpoints.md) | The token sync, global player clearance, the 820/680/540 ladder, the report iframe, tap targets, viewport meta |
| 6 | [`06-verification-and-screenshots.md`](./06-verification-and-screenshots.md) | How it was verified in-sandbox (build, tests, Playwright @375/390px, two subagent reviews) + what to re-check on a real device |

---

## Status legend

- ✅ **Built** — exists and works in the repo today
- 🟡 **Partial** — exists but worth a follow-up
- 🔜 **Planned** — candidate follow-up, not in this change

---

## TL;DR

- **Root problem:** the site shipped with one width breakpoint per surface (player
  `760`, release page `680`, homepage `540`) and the brand ladder
  (`820/760/680/540`) was otherwise absent. The audio player's seek and volume were
  **mouse-only** (`MouseEvent` + `mousedown/move/up`), so **scrubbing didn't work on
  touch** at all. ✅ fixed.
- **Direction B — the now-playing sheet.** On phones the player collapses to a slim
  bar (artwork + title + play + a gold hairline progress) that **taps up into a
  full-screen now-playing sheet**: large artwork, title, Space Mono catalog, a big
  draggable seek with time, a large teal play with restart/skip, and a volume
  slider. Native-app feel; desktop is unchanged. ✅
- **Touch input** is now unified on **Pointer Events** (`setPointerCapture` +
  `touch-action: none`), with visible drag thumbs — one code path for mouse and
  touch. ✅
- **Layout:** `initial-scale=1` + `viewport-fit=cover`; the `--player-height` token
  syncs to `58px` on mobile; player clearance is **global** (`body` padding keyed to
  the token + `env(safe-area-inset-bottom)`); the brand ladder is filled in on both
  pages; the proof-of-work report iframe fits the viewport instead of a fixed
  `520px`; tap targets are ≥44px on the primary surfaces. ✅
- **Scope:** CSS, markup, and `PlayerBar.svelte` JS only. No ingest / schema /
  storage / deploy changes. The desktop layout and the single-voice audio behavior
  are untouched. ✅

---

## Files changed

| File | Change |
|------|--------|
| `src/layouts/BaseLayout.astro` | viewport meta → `initial-scale=1, viewport-fit=cover` |
| `src/styles/tokens.css` | `--player-height` syncs to `58px` at `≤760px` |
| `src/styles/global.css` | global `body` bottom clearance for the fixed player + safe-area inset |
| `src/components/player/PlayerBar.svelte` | the now-playing sheet, collapsed mobile bar, Pointer-Events seek/volume, drag thumbs, expand affordance |
| `src/pages/index.astro` | brand breakpoint ladder, tap targets, cover/catalog passed to the player |
| `src/pages/releases/[slug].astro` | brand breakpoint ladder, report iframe height, tap targets, cover/catalog passed to the player |

_Last updated: 2026-06-11._
