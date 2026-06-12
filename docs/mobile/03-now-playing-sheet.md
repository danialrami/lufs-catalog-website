# 03 — The now-playing sheet (Direction B)

The centerpiece. On phones the player has two states living in one persisted
component (`src/components/player/PlayerBar.svelte`): a **collapsed bar** and a
**full-screen sheet**.

## Collapsed bar (mobile)

Below `760px` the bar becomes: `[artwork 40px] [title + catalog, truncating] [▲
expand chevron] … [play/pause]`. A **2px gold hairline** (`.bar-progress`) pinned to
the bar's top edge shows playback position (only visible once there's progress). The
inline desktop progress/time/volume cluster is hidden here — the full transport lives
in the sheet.

The whole `track-info` region is the open trigger:

```html
<div class="track-info" class:tappable={!!currentTrack}
     role="button" tabindex={currentTrack ? 0 : -1}
     onclick={openSheet} onkeydown={onTrackInfoKey}> … </div>
```

The `▲` chevron (`.bar-expand`, shown only `≤760px`) signals it's tappable.

## The sheet

A `position: fixed; inset: 0; z-index: 1100` overlay (`.now-sheet`) with a tinted
backdrop and a panel that **slides up** (`translateY(100%) → 0`). Contents, top to
bottom:

- **Top row** — a 44px close button (chevron-down) + a centered `NOW PLAYING` Space
  Mono label.
- **Large artwork** — `min(74vw, 360px)` square, rounded, soft shadow; a gradient
  fallback when there's no cover.
- **Title + catalog** — Host Grotesk title, Space Mono catalog in teal.
- **Seek** — a thin gold-fill track inside a **44px hit area** with a **visible 16px
  gold drag thumb** at the fill's leading edge; current/total time below.
- **Transport** — restart, a large 76px teal play/pause, skip-to-start.
- **Volume** — mute toggle + a teal-fill slider with its own drag thumb.

## State & lifecycle

- `sheetOpen` (plain reactive `let`, matching the component's existing style) toggles
  `class:open`. Closed state is `visibility: hidden; pointer-events: none`, so the
  sheet is fully inert when down — including on desktop, where it never opens.
- `openSheet()` is **gated to mobile**: it early-returns when
  `matchMedia('(min-width: 761px)')` matches, so tapping the desktop track-info does
  nothing (the inline controls are already there).
- **Body scroll lock.** Opening sets `document.body.style.overflow = 'hidden'`;
  closing clears it. `onMount` also clears it unconditionally and `onDestroy` clears
  it — so a lock can never get "stuck" across a navigation.
- **Focus & keyboard.** On open, focus moves to the close button; `Escape` closes
  (handled in the existing global `keydown` handler, which also keeps Space =
  play/pause and arrows = volume).
- **Dismiss** via the close button, the backdrop, or `Escape`.

## Persistence across navigation

The player island is mounted with `transition:persist="player-bar"` and the runtime
audio state lives on `window` (see `audioManager.ts`), so playback survives
client-side navigation. The sheet's *open* state is intentionally **not** persisted —
the sheet has no internal navigation, so it simply resets closed on a route change,
and the `onMount` overflow-reset guarantees the page is never left scroll-locked.

## Artwork enrichment (a required prerequisite)

The sheet needs cover art, but the `play-track` event historically carried only
`{ audioPath, trackTitle }` — which is why the bar never showed art. Both pages now
pass the cover + catalog they already have:

```js
window.dispatchEvent(new CustomEvent('play-track', { detail: {
  audioPath, trackTitle, coverArt, catalogNumber,
}}));
```

`handlePlayTrack` maps `coverArt → artwork.main` and `catalogNumber` onto the track,
so the **collapsed bar, the desktop bar, and the sheet** all show real artwork. No
schema change — these fields already exist on each release/track and are read from
`data-cover` / `data-catalog` attributes on the play buttons.
