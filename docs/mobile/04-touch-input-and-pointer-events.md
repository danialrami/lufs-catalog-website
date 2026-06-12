# 04 — Touch input & Pointer Events

## The root bug

The seek and volume bars were **mouse-only**:

- Seek: `onclick={handleSeek}` typed `(e: MouseEvent)`.
- Volume: `onmousedown` → `window.addEventListener('mousemove' | 'mouseup', …)`.

On a touchscreen a tap synthesizes a click, so tap-to-seek sort of worked — but
**dragging to scrub did nothing**, because no `touch*`/`pointer*` listeners existed.
This is the core "the playbar isn't right" symptom.

## The fix — one code path for mouse and touch

Both controls now use the **Pointer Events API**, which unifies mouse, touch, and
pen. The handlers are shared by the desktop bar's progress, the sheet's seek, and
both volume sliders:

```ts
function handleSeekPointerDown(e: PointerEvent) {
  const bar = e.currentTarget as HTMLElement;
  isScrubbing = true;
  try { bar.setPointerCapture(e.pointerId); } catch {}
  seekFromClientX(e.clientX, bar);
}
function handleSeekPointerMove(e: PointerEvent) {
  if (isScrubbing) seekFromClientX(e.clientX, e.currentTarget as HTMLElement);
}
function handleSeekPointerUp(e: PointerEvent) {
  isScrubbing = false;
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
}
```

Bound as `onpointerdown` / `onpointermove` / `onpointerup` / `onpointercancel`.
Volume mirrors this exactly (`handleVolumePointerDown/Move/Up`).

Two details make drag reliable on touch:

- **`setPointerCapture(e.pointerId)`** routes all subsequent move/up events to the
  bar element even if the finger slides outside it — so a scrub that drifts off the
  thin track keeps working, and there are no window-level listeners to leak.
- **`touch-action: none`** on every interactive bar tells the browser *not* to
  interpret the drag as a page scroll/zoom, so the gesture belongs to the scrubber.

`seekFromClientX(clientX, bar)` computes the fraction from the bar's
`getBoundingClientRect()`, clamps to `[0,1]`, calls `audioManager.seek()`, and
updates **all** progress fills (desktop bar, mobile hairline, sheet) + the time
displays through shared `updateProgressUI()` / `updateTimeDisplay()` helpers.
`volumeFromClientX` does the same for the two volume fills via `setVolumeLevel`.

## Drag affordance

Pointer handling alone is invisible. The sheet's seek and volume each carry a
**visible circular thumb** (`.sheet-knob`) at the fill's leading edge — gold on the
seek, teal on the volume — with a soft halo. This makes the controls obviously
grabbable, which a 6px bar alone does not.

## Keyboard (unchanged, still works)

The global `keydown` handler keeps `Space` = play/pause and `←/→` = volume ±, and now
adds `Escape` = close the sheet. The bars keep `role="slider"` with live
`aria-valuemin/max/now`, and all interactive controls have `:focus-visible` outlines.
