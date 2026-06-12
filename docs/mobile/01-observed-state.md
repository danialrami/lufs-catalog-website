# 01 — Observed state (what was wonky on mobile)

A read of the layout, styles, and player as they stood on `main` before this
change. The desktop site was already on-brand; the problems were all on small
screens. Audited file by file.

## The headline problems

1. **The playbar didn't work on touch.** The seek bar's only handler was
   `onclick={handleSeek}` typed `MouseEvent`, and volume used
   `mousedown`/`mousemove`/`mouseup`. A tap registers as a click, so tap-to-seek
   limped along, but **drag-to-scrub did not work at all on a phone** — the single
   biggest "the playbar isn't right" symptom.
2. **One breakpoint per surface.** The brand breakpoints are `820 / 760 / 680 / 540`.
   The repo had exactly one each, in three different files, with nothing in between
   and large gaps:

   | Breakpoint | `index.astro` | `[slug].astro` | `PlayerBar.svelte` |
   |---|---|---|---|
   | 820px | — | — | — |
   | 760px | — | — | ✅ |
   | 680px | — | ✅ | — |
   | 540px | ✅ | — | — |

3. **The player bar overflowed narrow screens** below its single `760px` query, and
   even with it, several elements had no good small-screen home.

## File by file

**`src/layouts/BaseLayout.astro`**
- Viewport meta was `width=device-width` with **no `initial-scale=1`** — some mobile
  browsers can apply a non-1 default scale.
- The player is mounted in a `position: fixed` `<footer>` (`z-index: 1000`).
- Player **clearance was ad-hoc per page** (`padding-bottom` on `.grid` / `.tracks`
  / `.streaming`), so any new page that forgot the pattern would hide its last rows
  under the bar.

**`src/styles/tokens.css`**
- `--player-height: 72px` was a single global value, even though the bar visually
  shrank to `60px` under `760px` — so every `calc(var(--player-height) + …)`
  clearance over-reserved ~12px on mobile.

**`src/styles/global.css`**
- Only `@media (hover: none)` and `@media (prefers-reduced-motion: reduce)` — **no
  width-based breakpoints at all.**

**`src/components/player/PlayerBar.svelte`**
- Desktop bar laid out as `track-info (min-width:200px) | controls (play + 300px
  progress + time) | icons (next + 120px volume)` — a **~840px minimum** before
  overflow, vs a 375px phone.
- One `@media (max-width: 760px)` block: shrank the bar to `60px`, hid `.time-display`
  and `.icons`, and clamped the progress width. Functional, but the seek stayed
  mouse-only and there was no expanded view — volume and skip simply disappeared.
- The `play-track` `CustomEvent` carried only `{ audioPath, trackTitle }`, so the bar
  **never showed cover art or catalog**, even on desktop.

**`src/pages/index.astro`**
- Grid `repeat(auto-fill, minmax(290px, 1fr))` (wraps naturally) + a single
  `540px → 1fr` collapse. Card play buttons were `26px`, filter chips ~`28px` tall —
  under the 44px tap-target minimum.

**`src/pages/releases/[slug].astro`**
- `.rel-grid` two-column (`minmax(200px,320px) 1fr`) with a single `680px` stack.
- The embedded proof-of-work report `<iframe>` was a **fixed `height: 520px`** with
  no mobile reduction — awkward to scroll past on a phone.
- Track-row play buttons `38px` — just under 44px.

## Already correct (left alone)

- The custom cursor is `@media (hover: none)`-gated and JS-guarded — correctly absent
  on touch.
- Scroll-reveal has a force-show fallback and respects reduced motion.
- The single-voice audio manager and `transition:persist` player persistence work and
  were **not** touched.
