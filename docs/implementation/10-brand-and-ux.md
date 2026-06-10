# 10 — Brand & UX Pass (Phase 4)

Applies the LUFS Brand Design System to the catalog. Kept CSS-led and additive so
it can't break the build; the structural edits were minimal.

## What changed
- **`src/styles/tokens.css`** — full brand tokens: the four-color spectrum (teal
  leads), muted text/hairline values, and the type stack — **Host Grotesk**
  (display), **Public Sans** (body), **Space Mono** (data/labels).
- **`src/styles/global.css`** — brand typography defaults, `.eyebrow`/`.sec-label`
  mono labels, the **custom cursor** (dot + lagging ring, blend-difference,
  desktop-only), and **scroll-reveal** that is **JS-gated** (`.js .reveal`) so no-JS
  users never see hidden content, plus `prefers-reduced-motion` handling.
- **`src/layouts/BaseLayout.astro`** — loads the three Google Fonts; mounts the
  cursor elements; runs the cursor (once) + scroll-reveal init on every
  `astro:page-load` with a **force-show fallback** (1.2 s) so nothing can get stuck
  hidden. Player bar unchanged.
- **`src/pages/index.astro`** — brand fonts; **the project legend filter now
  actually works** (cards carry `data-project`; the script shows/hides by it — it was
  previously a no-op); cards get a teal hover border + `reveal`.
- **`src/pages/releases/[slug].astro`** — brand fonts; surfaces **loudness**
  (final LUFS + true peak) and the catalog number in the track meta; adds an
  **embedded, sandboxed Proof-of-Work report** per track via a collapsible
  `<details>` (`sandbox="allow-same-origin"`, `loading="lazy"`) — implementing the
  PRD's proof-of-work section. The "Open report ↗" link remains for the full view.

## Honesty / brand rules honored
- Single-accent discipline (teal leads; gold/blue used only as catalog/project
  badges). Dark ground, hairlines, monospace data — the "record-label internal
  system, made public" register.
- No permanently-hidden content (JS-gated reveal + force-show fallback).
- External links use `target="_blank" rel="noopener noreferrer"`.
- The workchain report already ships in LUFS colors, so the embed reads on-brand.

## Build-sensitive — verify after `pnpm build`
These are `.astro`/`.svelte`/CSS changes that the agent sandbox can't build (npm
registry blocked). Please `pnpm build` + eyeball: fonts load, the legend filters,
the player still plays + persists, the report embed renders, and reduced-motion is
respected. Low risk (CSS-led, additive), but it needs your eyes once.

## Deferred / optional
- A morphing point-cloud WebGL hero (the family's signature) — heavier; the catalog
  is intentionally calmer than `lufs.audio`. Easy to add later on the home header.
- Surfacing the workchain **chapter markers** (intro/break/…) as a track sections
  timeline — noted in the plan as a nice future touch.
