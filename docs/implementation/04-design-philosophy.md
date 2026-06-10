# 04 — Design Philosophy

The reasoning behind the choices, so future-you (or a future agent) understands
*why*, not just *what*. When a decision feels arbitrary later, start here.

---

## P1. The catalog is a *proof-of-work record*, not just a music player

Every entry carries its workchain provenance — catalog number (`lufs-<hash8>`),
full SHA256, processed date, loudness/saturation, and the embedded report. The
aesthetic ("a record label's internal system, made public") follows from this: the
data **is** the design. Monospace catalog numbers and hashes are first-class visual
elements, not footnotes.

**Implication:** don't hide the provenance to look "cleaner." Surface it. The site's
credibility for industry/press is the SHA256 and the report.

---

## P2. Static-first, JS-only-where-it-earns-it

Astro `output: 'static'` means the catalog is just files on a CDN — cheap, fast,
hard to break, and trivially cacheable. The **only** real interactivity is the
audio player, so that's the **only** hydrated island (a Svelte component). Pages
ship ~zero JS by default.

**Why it matters:** a catalog is a long-lived archive. Static HTML will still render
in ten years; a heavyweight SPA framework might not. Lower surface area = lower
maintenance.

---

## P3. Audio doesn't belong in git

Audio is large, binary, and grows forever. Putting it in the repo bloats clones,
slows CI, and (worse) makes every track a one-click download. So:

- **Big/binary → object storage** (R2): audio, large render-stats.
- **Small/text → repo** (`public/`): the ~13KB `final_report.html`, cover art.

This split is the backbone of the storage design.

---

## P4. Separate the *archive* from what the *website serves*

The NAS is the canonical archive (WAV, logs, every artifact). The website serves a
**derived, web-optimized subset** (MP3 + small reports + art). Conflating the two is
how archives rot and sites bloat. The ingest is precisely the boundary that derives
"web assets" from "the archive."

**Corollary:** losing the website's served files is a non-event — they're
regenerable from the archive by re-running ingest.

---

## P5. Decouple availability from owned hardware — but keep a way home

Daniel's stated worry: NAS hardware won't last forever. So the **primary** public
origin is **R2** (someone else's problem to keep online), not the NAS. But we don't
want to be *fully* captive to one vendor either — hence the **NAS rustfs fallback**:
the site keeps working if Cloudflare has a bad day, and the data has a second home
we control.

This is a deliberate "primary cloud, secondary self-hosted" posture: convenience and
durability from the cloud, sovereignty and resilience from the NAS. (See
[`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md), including the subtle point
that the fallback's *network path* must not itself depend on Cloudflare.)

---

## P6. Economics: optimize for *egress*, because that's what bites

For audio that's mostly parked with occasional listens, the cost that surprises
people is **egress** (bandwidth out). R2 charges **\$0 egress**, which makes it the
cheapest realistic option here even though its per-GB storage isn't the absolute
lowest. We optimize for the bill we'd actually get, not the headline storage rate.
Details + a comparison table live in [`06-cdn-and-s3-guide.md`](./06-cdn-and-s3-guide.md).

---

## P7. Protect audio with *expiring, server-signed* URLs

We don't want durable hotlinks or a download button on released tracks. So audio
lives in a **private** bucket prefix, and a tiny **Worker** mints **presigned URLs**
that expire (~1h). The signing secret never reaches the browser; the page never
contains a permanent URL or the R2 key. It's not DRM (nothing in a browser is), but
it removes the easy download and the durable hotlink — proportionate to the goal.

---

## P8. Migration-friendly data model: URLs are just strings

Track records expose `audioPath`, `renderStatsPath`, `finalReport` as plain string
URLs. Local dev sets them to `/audio/…`; production sets them to R2 URLs (or, via the
player, a key that the Worker signs). **No component code changes between local and
cloud** — only the stored values change. This is what makes "develop locally, ship to
the CDN" painless.

---

## P9. Prefer structured truth (`context.json`) over scraping HTML

The original ingest regex-scrapes the report HTML — brittle, breaks if the template
changes. The astro-catalog chain emits **`context.json`**; we parse that and keep
HTML scraping only as a fallback for legacy shapes. Structured input → fewer silent
failures.

---

## P10. Idempotent, edit-preserving ingest

Re-running ingest must be safe and must **not** clobber human edits (the real title,
ISRC, streaming links added after DSP approval). The ingest owns machine-derived
fields; humans own editorial fields; the merge respects that boundary. A pipeline
you're afraid to re-run isn't a pipeline.

---

## P11. One source of config, no secrets in the open

All paths/URLs/credentials live in a single `.env` (gitignored), with a committed
`.example`. `PUBLIC_`-prefixed vars are the *only* ones allowed into the browser
bundle; R2 keys are server/script/Worker-only. This keeps the "oops I committed a
key" failure mode out of reach.

---

## P12. Brand is a system, not a paint job

The catalog is one member of the LUFS web family, so it inherits the shared design
system (dark ground, single teal accent, Host Grotesk / Public Sans / Space Mono,
hairlines, the proof-of-work monospace register) rather than inventing its own look.
Consistency across `lufs.audio`, the catalog, and the reports is the point — it's a
*common design language*. We also keep the non-negotiables: no permanently-hidden
content (force-show fallback), honor reduced-motion, quote HTML attributes.

---

## P13. Build-and-test here, run-where-the-data-is

An agent/CI can't reach the NAS or run REAPER. Rather than fight that, we embrace it:
the agent builds and **proves the code against a sample**, and the heavy,
data-adjacent steps run on Daniel's Mac. The deliverable is *correct, tested code +
a clear runbook*, not a magic remote execution.
