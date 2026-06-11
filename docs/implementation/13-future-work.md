# 13 — Future Work (roadmap / backlog)

The catalog is **live and stable**: astro-catalog ingest → R2 (private audio + public
covers/reports) → CI build → Hostinger, with a single-voice persistent player and stable
per-track object keys. This doc is a **living backlog of candidate next steps** — not
commitments. Each item notes rough effort and links the relevant doc. Pull from the top;
re-order freely.

Effort: 🟢 small · 🟡 medium · 🔴 large.   Status: 🔜 ready (designed/low-risk) · 💭 exploratory.

---

## Near-term — already designed or low-effort

- **Stand up the NAS rustfs origin + fallback.** 🟡 🔜 The dual-write mirror and the
  player/report failover are already written and commented; standing up a rustfs S3 endpoint
  behind a TLS proxy lets you flip `STORAGE_PRIMARY=rustfs` (or mirror to it) and fail over
  automatically when R2 is unreachable. This also doubles as an off-Cloudflare backup of the
  catalog. Full checklist: [`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md).
- **Build-health CI check on PRs.** 🟢 🔜 A no-secrets workflow (`pnpm install --frozen-lockfile
  && pnpm build && pnpm astro check`) that runs on pull requests, catching a broken content
  `.md` or dependency before it can reach `main` / the deploy. Complements the existing
  deploy workflow (see [`09-ingest-and-deploy.md`](./09-ingest-and-deploy.md) §3).
- **Parallelize R2 uploads in the ingest.** 🟡 🔜 Covers/reports upload sequentially today, which
  is the bulk of a full re-ingest (the stable-key migration ran ~1h52m, almost all upload I/O).
  A small concurrency limit (e.g. 8–16 in-flight `uploadObject`/`copyObject` calls) would cut
  full re-ingests to minutes. Steady-state incremental ingests are already fast (skip-unchanged).
- **Trim the public bucket (drop the canvas GIF).** 🟢 💭 The per-track canvas **GIF** (tens of
  MB) is the bulk of `lufs-catalog-public` (14.59 GB today) and is largely redundant with the
  canvas **MP4**. Dropping just the GIF from the report (keep MP4 + static PNG) would likely pull
  storage back under the 10 GB free tier — i.e. ~$0 vs ~$0.09/mo. It's a fidelity tradeoff, so
  opt-in; see [`06-cdn-and-s3-guide.md`](./06-cdn-and-s3-guide.md) §9.8 for the cost levers.
- **Refresh the e2e fixtures.** 🟢 🔜 `catalog.spec.ts` still references the old `Continuo`
  fixture; point it at a current release and assert the id-keyed audio/cover/report URLs resolve.
- **`release-auditor` opencode subagent.** 🟢 🔜 A read-only agent that walks every
  `src/content/releases/*.md` and verifies each track's audio key signs, and its cover/report
  URLs return 200 — run on demand or before a deploy. Wiring: [`08-opencode-agent.md`](./08-opencode-agent.md) §7.

---

## Medium-term — operability & growth

- **Site health monitor.** 🟡 A scheduled check that `catalog.lufs.audio` is up, a sample track
  signs + streams (Worker 200/206), and covers/reports load without 404s — alerting on drift.
  Natural fit for a live-mode agent now that keys are stable and predictable.
- **Search / sort / richer filtering.** 🟡 The catalog is ~110 tracks across ~14 releases and
  growing; a client-side search box and sort (by date/title/loudness) plus multi-tag filtering
  would scale browsing beyond the current project filter.
- **Discoverability: sitemap, RSS, per-release OpenGraph.** 🟡 Generate a sitemap + an RSS/JSON
  feed of releases, and per-release OG/Twitter images (reuse the existing cover art) so shared
  links render well.
- **Backup / DR posture.** 🟡 Masters live on the NAS and the web-ready derivatives live on R2;
  document (and ideally automate) a periodic snapshot of both buckets. The rustfs mirror above
  largely satisfies this once it's up.

---

## Exploratory — worth a spike before committing

- **EmDash CMS layer.** 💭 A Cloudflare CMS on Astro was researched as a possible content
  surface for editing release frontmatter without hand-editing `.md`. For a single-operator,
  git-backed catalog the current approach is preferred; revisit if non-technical editing is
  ever needed. See [`../emdash-research.md`](../emdash-research.md) and
  [`../emdash-future-plans.md`](../emdash-future-plans.md).
- **Privacy-respecting play metrics.** 💭 Lightweight, cookieless play counts (e.g. an edge
  counter keyed by the track's `lufs-id`) to see what's listened to — without trackers.
- **Content-addressed audio / dedup.** 💭 Keys are already per-track (`<lufs-id>`); a fully
  content-addressed scheme (key = `source_sha256`) would dedup identical masters across releases
  and make re-keying a non-event. Low priority — the current scheme already removed renumber churn.

---

## Done recently (context for the above)

- **Stable per-track keys** — `releases|covers|reports/<id>/<lufs-id>/…`; add/remove/reorder
  touches only the changed track. Migrated the whole catalog with no re-encode (server-side copy).
- **Public CDN bucket** — covers + the full proof-of-work report on `cdn.lufsaud.io`; git/Hostinger
  stay tiny; audio stays private + signed.
- **CI owns deploy** — push `main` → GitHub Actions build → `hostinger` branch → Hostinger.
- **Single-voice player** — window-scoped Howl singleton; no cross-navigation overlap.
- **Manifest-aware prune** — `R2_PRUNE=dry|apply` cleans exactly the orphans a removal leaves.
