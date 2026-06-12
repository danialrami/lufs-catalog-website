# 05 — Responsive layout & breakpoints

The non-player layout work: the viewport, global player clearance, the
`--player-height` token, the brand breakpoint ladder, the report iframe, and tap
targets.

## Viewport meta

`src/layouts/BaseLayout.astro`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`initial-scale=1` pins the default zoom; `viewport-fit=cover` is what lets
`env(safe-area-inset-*)` resolve to real values on notched devices.

## `--player-height` token sync

`src/styles/tokens.css` keeps the desktop `72px` but syncs the token to the
collapsed bar height on mobile, so **every** clearance calc stays correct:

```css
@media (max-width: 760px) { :root { --player-height: 58px; } }
```

## Global player clearance

Per-page `padding-bottom` was replaced with a single global rule in
`src/styles/global.css`, keyed to the token and the safe-area inset:

```css
body {
  padding-bottom: calc(var(--player-height) + var(--space-8) + env(safe-area-inset-bottom, 0px));
}
```

The ad-hoc `padding-bottom` on `index.astro`'s `.grid` and `[slug].astro`'s
`.tracks` / `.streaming` were removed so the clearance can't double up. Net effect:
no page can ever hide its last rows under the fixed bar, and the iOS home indicator
is cleared automatically.

## The brand breakpoint ladder

Filled in `820 / 760 / 680 / 540` where each surface actually needs it.

**`index.astro`** (homepage grid):

| ≤820px | `minmax(290px,1fr)` → `minmax(240px,1fr)` (tablet keeps 2–3 cols) |
| ≤680px | `repeat(2, 1fr)`, tighter cards, per-card track preview hidden (cards link to the full tracklist) |
| ≤540px | single column, track preview back, `sec-label` hidden, tap targets bumped |

**`[slug].astro`** (release detail):

| ≤820px | `.rel-grid` cover column narrows (`minmax(180px,260px)`) |
| ≤680px | `.rel-grid` stacks to one column; cover capped; `report-link` hidden; **report iframe → `min(70vh, 460px)`** |
| ≤540px | cover full-width; tighter track rows; **44px** play buttons; **report iframe → `64vh`** |

**`PlayerBar.svelte`** keeps its `760px` collapse (now the full collapsed-bar +
sheet behavior described in [`03`](./03-now-playing-sheet.md)).

## The proof-of-work report iframe

Was a fixed `height: 520px` regardless of screen. It now fits the viewport on mobile
(`min(70vh, 460px)` at ≤680px, `64vh` at ≤540px), so the report is comfortably
scrollable instead of dominating the page.

## Tap targets

- Release-page track play buttons → **44px** at ≤540px (the primary listening
  surface).
- Homepage card play buttons → **38px**; filter chips → **40px min-height** at
  ≤540px (secondary surface — cards themselves are large tap targets that link to the
  release page).
- Player: collapsed-bar play **44px**; sheet close/transport/volume buttons all 44–76px.
