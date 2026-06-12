# 07 — Next steps (mobile backlog)

The mobile work in this suite is **live** on `catalog.lufs.audio` and was confirmed
on a real device — **Pixel 10 Pro / Brave, 2026-06-12**: album artwork pulls, the
now-playing sheet opens, and touch scrubbing works. This doc is the canonical backlog
for the follow-ups we deliberately deferred (it supersedes the short "Follow-ups"
note at the end of [`06`](./06-verification-and-screenshots.md)).

## 1. Real previous / next track — album queue 🔜

**Observed:** the sheet's side transport buttons (and the desktop bar's "next") just
**restart the current track** instead of moving through the album.

**This is general playbar logic, not mobile-specific.** The player has no active
queue: `playerStore.ts` defines a `queue` + `playNext()`, but `PlayerBar.svelte`
doesn't use them — both side buttons call `restartTrack()` (seek 0 + play). It was
left honest (seek-to-start) rather than faking navigation that doesn't exist yet.

**To implement:**
- **Seed a queue on play.** The dispatching page sends the album's ordered tracklist
  (+ the started index) in the `play-track` event — an extension of the same
  enrichment that already passes `coverArt`/`catalogNumber` — or the store is seeded
  from the release the play originated on.
- **Track a current index.** `next()` / `prev()` load the adjacent track via
  `audioManager.loadAudio`; `onEnd` auto-advances to the next.
- **Edge cases:** first/last track (disable the control or wrap), single-track
  releases (hide prev/next), and cross-page persistence (the queue lives on
  `window` / the store like the rest of the player runtime, so it survives
  ViewTransitions).
- **Scope note:** this touches `PlayerBar.svelte`, `playerStore.ts`/`audioManager.ts`,
  and the two pages' `play-track` dispatch — a bit beyond the surface-only line this
  suite held, so it's its own change.

## 2. Swipe-down-to-dismiss the now-playing sheet 🔜

**Observed:** the instinct on a phone is to **swipe the sheet down** to close it;
today you have to tap the top-left chevron, which is easy to forget.

**To implement** (consistent with the Pointer-Events approach already used for
seek/volume):
- On the sheet panel, capture `pointerdown` Y, follow `pointermove` with a live
  `translateY` on the panel (and fade the backdrop), and on `pointerup` dismiss if
  dragged past a threshold (≈25% of panel height, or a fast downward flick) — else
  spring back to 0.
- Only begin the gesture from the top region / when the panel is scrolled to top, so
  it doesn't fight the sheet's inner scroll.
- Respect `prefers-reduced-motion` (skip the follow animation; just dismiss past the
  threshold). Keep the existing chevron, backdrop tap, and `Escape` as alternative
  dismissals.

## 3. Committed mobile smoke test 🔜

A small Playwright test under `src/tests/` at a mobile viewport that loads a track,
opens the sheet, and asserts the seek + transport render — to guard the
collapsed-bar → now-playing-sheet flow in CI. (The redesign was verified with a
throwaway screenshot script; this would make it a standing check.)

## Nice-to-haves

- Revisit volume placement / behavior once a real queue exists.
- Optional momentum/haptic polish on the sheet gesture.

_Last updated: 2026-06-12._
