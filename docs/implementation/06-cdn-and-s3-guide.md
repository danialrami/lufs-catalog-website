# 06 — CDN & S3, From Scratch

A plain-language guide for someone who hasn't used object storage or a CDN before.
Read this once and the rest of the project's storage talk will click. We end with
the **exact steps** to set up Cloudflare R2 for this project.

---

## 1. The problem we're solving

We have audio files. They're big, and there will be more of them over time. Where do
they live so that:

1. a web browser anywhere can fetch them quickly,
2. it's cheap when files mostly just sit there with occasional listens,
3. they're durable (won't vanish if a hard drive dies), and
4. they're **not** baked into our website's code repo (which would bloat it and turn
   every track into a free download)?

The answer the industry settled on is **object storage**, usually spoken to through
the **S3 API**, often **fronted by a CDN**. Let's define each.

---

## 2. Object storage (the "S3" idea)

**Object storage** is a giant, cloud-hosted dictionary: you store **objects** (files)
under **keys** (string names), inside a **bucket** (a namespace you own).

```
bucket: lufs-catalog
  key: releases/continuo/lufs-5cfa866d/track.mp3   → [the bytes of that mp3] + metadata
  key: reports/continuo/lufs-5cfa866d/final_report.html → [bytes] + metadata
  key: covers/continuo/lufs-5cfa866d/artwork.png   → [bytes] + metadata
```
> Keys are keyed by the per-track **`lufs-id`** (the workchain catalog number), not the
> track's ordinal — see `09-ingest-and-deploy.md`. (Covers + the report now live in the
> PUBLIC bucket `lufs-catalog-public`, served from `cdn.lufsaud.io`; only audio stays in the
> private `lufs-catalog`.)

Mental model: **a key→file map in the cloud.** A few things that surprise newcomers:

- **There are no real folders.** The `/` in a key is just part of the string. We
  *call* `releases/` a "prefix" and it behaves like a folder in dashboards, but the
  store is flat. This is why you'll hear "prefix" instead of "folder."
- **Each object has metadata**, most importantly a **Content-Type** (e.g.
  `audio/mpeg`, `text/html`, `image/png`) so browsers know what they're getting.
- **Objects are whole-file.** You typically PUT (upload) or GET (download) an entire
  object. You don't open and seek-write like a local file.

### What is "S3"?

**S3** (Simple Storage Service) is Amazon's object store, launched in 2006. Its HTTP
API became *the de-facto standard*, so now many providers offer an **S3-compatible
API**: Amazon S3, **Cloudflare R2**, Backblaze B2, Wasabi, MinIO, **rustfs**, and
more. "S3-compatible" means the same SDKs and tools (the AWS SDK, `rclone`, etc.)
work against them by just changing the **endpoint** and credentials.

> This compatibility is exactly why our **NAS rustfs fallback** is feasible: rustfs
> speaks the same S3 API, so the same upload code works against it by swapping the
> endpoint. (See doc 07.)

### The four things you need to talk to any S3 store

1. **Endpoint** — the base URL of the service (e.g.
   `https://<account>.r2.cloudflarestorage.com`).
2. **Access Key ID** — like a username for programmatic access.
3. **Secret Access Key** — the matching password. **Secret.** Never commit it.
4. **Bucket name** — which bucket to read/write.

(There's also a **region**; R2 uses `auto`.)

---

## 3. Public vs private objects

Each object (or prefix) is either:

- **Public** — anyone with the URL can GET it. Good for things meant to be seen:
  cover art, the render-stats HTML, identicons. URL looks like
  `https://pub-xxxx.r2.dev/artwork/continuo/cover.png` (or a custom domain).
- **Private** — not reachable by URL alone. To grant temporary access you generate a
  **presigned URL** (next section). Good for the audio we don't want freely
  downloadable or hotlinked.

For this project:

| Prefix | Access | Why |
|--------|--------|-----|
| `releases/` | **private** | audio — served only via short-lived signed URLs, no durable hotlink/download |
| `reports/` | public | render-stats HTML embedded in an iframe |
| `artwork/` | public | covers/spectrograms shown on the page |

> **Implementation note (corrects this table):** R2 public access is **bucket-level**,
> not per-prefix — a public bucket exposes *everything* in it. So as built (see
> `09-ingest-and-deploy.md` §4.1) the split is **two buckets**, not mixed prefixes in one:
> **private `lufs-catalog`** holds the audio (`releases/`, signed by the Worker), and a
> **public `lufs-catalog-public`** holds covers + the proof-of-work report (`covers/`,
> `reports/`), served read-only from `cdn.lufsaud.io`. (Earlier the public assets were
> committed into the repo's `public/` instead; the second bucket replaced that so heavy
> canvas media stays out of git. The mental model below is unchanged.)

---

## 4. Presigned URLs (how we serve private audio)

A **presigned URL** is a normal-looking URL with a cryptographic signature and an
**expiry** baked into the query string. It says: "whoever holds this may GET this one
private object, until it expires." It's generated **server-side** using the secret
key — the secret itself never travels to the browser.

Our flow:

1. The static page knows a track's **key** (`releases/continuo/lufs-5cfa866d/track.mp3`) — not a URL.
2. On play, the browser asks our **Worker**: `GET https://stream.lufs.audio?key=releases/continuo/lufs-5cfa866d/track.mp3`.
3. The Worker (holding the secret) returns a **1-hour** presigned URL.
4. The player streams from it. After an hour the URL is dead.

Why bother? Because it means: **no permanent link** to copy/share, **no R2 key in the
page source**, **no download button**, and you can revoke access by rotating keys.
It's not unbreakable DRM (a determined person can capture a stream), but it removes
the *easy* download and the *durable* hotlink — which is exactly the stated goal.

---

## 5. What is a CDN, and where does it come in?

A **CDN** (Content Delivery Network) is a fleet of servers ("edge" locations / POPs)
spread around the world that **cache** your files close to users. A listener in
Berlin hits a Berlin edge instead of a bucket in North America — faster, and it takes
load off the origin.

For us, **Cloudflare R2 lives inside Cloudflare's network**, so R2 objects are served
through Cloudflare's global edge essentially for free. You don't run a separate CDN —
choosing R2 *is* choosing the CDN. (You can also put a custom domain like
`cdn.lufs.audio` in front of a public bucket and get edge caching with your own name.)

```
Listener ──► nearest Cloudflare edge ──(cache miss)──► R2 bucket (origin)
             (cache hit = fast,                       (only on miss)
              no origin egress)
```

---

## 6. Egress — the cost that actually bites (and why R2 wins here)

**Egress** = data transferred *out* to users (downloads/streams). Most clouds charge
per-GB **storage** *and* per-GB **egress**. For media that gets streamed, **egress is
usually the bigger, scarier bill** — and it's unpredictable (one popular link can
spike it).

**Cloudflare R2's headline feature: \$0 egress.** You pay for storage and for
operations, but **not** for bandwidth out. For "audio mostly parked, occasional
client views," this is the cheapest realistic option, and it removes the "what if a
track goes semi-viral" bill anxiety.

### Exactly what you pay on R2 (answering "free to upload, small fee to stream?")

Close — here's the precise breakdown. R2 bills **three** things, and egress is not
one of them:

| What | R2 charge | Free tier / month | At our scale |
|---|---|---|---|
| **Store** files | ~\$0.015 / GB-month | first **10 GB** free | pennies (e.g. 50 GB stored → (50−10)×\$0.015 ≈ **\$0.60/mo**) |
| **Upload / write** ("Class A" ops: PutObject, list) | \$4.50 / million | first **1,000,000** free | effectively **\$0** (you write hundreds of objects, not millions) |
| **Stream / read** ("Class B" ops: GetObject) | \$0.36 / million | first **10,000,000** free | effectively **\$0** (you'd need millions of plays/mo to owe cents) |
| **Egress** (bandwidth out) | **\$0** | — | **always free** |

So: **uploading is effectively free** (Class A ops, huge free tier), **streaming is
effectively free** (Class B reads + zero bandwidth charge), and the only bill you'll
realistically see is **storage above the 10 GB free tier** — cents to a couple
dollars a month. The thing that makes other clouds expensive for audio (per-GB
egress) simply doesn't exist on R2. The signing **Worker** also runs on the Workers
free tier (100k requests/day), so it's free at this scale too.

> Because even that storage bill is real (if small), we also build a deliberate
> **switch to the NAS rustfs origin** — see §11 and `07-nas-rustfs-fallback.md`. If
> you ever don't want to pay Cloudflare at all, flip `STORAGE_PRIMARY=rustfs` and
> serve from the NAS.
>
> *(Rates as of this writing — verify current Cloudflare R2 pricing; the zero-egress
> model is the durable point.)*

### Rough cost comparison (illustrative — check current pricing)

Assume ~**20 GB** stored and ~**50 GB/month** streamed out:

| Option | Storage (~20 GB) | Egress (~50 GB/mo) | Notes |
|--------|------------------|--------------------|-------|
| **Cloudflare R2** | ~\$0.015/GB-mo → ~\$0.30/mo | **\$0** | 10 GB storage free tier; zero egress; native CDN |
| AWS S3 (+CloudFront) | ~\$0.023/GB-mo → ~\$0.46/mo | ~\$0.085/GB → ~\$4.25/mo | egress dominates; more moving parts |
| Backblaze B2 | ~\$0.006/GB-mo → ~\$0.12/mo | free via Cloudflare alliance, else ~\$0.01/GB | cheapest storage; egress-free *through* Cloudflare |
| NAS (rustfs), self-hosted | \$0 marginal | \$0 (your home uplink) | no vendor bill, but your hardware/uptime/bandwidth; **our fallback**, not primary |

Takeaways: at this scale every option is *cents*, so we optimize for **predictability
and zero egress surprises** (R2), **simplicity** (one vendor, already CDN-fronted),
and **resilience** (NAS fallback we control). Storage micro-savings (B2) don't move
the needle here.

---

## 7. CORS (why the browser needs permission)

Browsers enforce **CORS** (Cross-Origin Resource Sharing): JavaScript on
`catalog.lufs.audio` can only fetch from another origin (like the Worker, or a public
R2 URL) if that origin **says it's allowed**. So we configure CORS to allow our site's
origin. If you ever see a browser console error like *"blocked by CORS policy,"* this
is the knob. Our policy:

```json
[{ "AllowedOrigins": ["https://catalog.lufs.audio"],
   "AllowedMethods": ["GET"],
   "AllowedHeaders": ["*"],
   "MaxAgeSeconds": 3600 }]
```

(During local dev you may also allow `http://localhost:4321`.)

---

## 8. Glossary (quick reference)

- **Bucket** — your top-level storage namespace.
- **Object** — a stored file.
- **Key** — an object's name/path within a bucket (the `/`s are cosmetic).
- **Prefix** — a leading slice of keys we treat like a folder (`releases/`).
- **Endpoint** — the service's base URL your tools point at.
- **Access Key ID / Secret Access Key** — programmatic username/password.
- **Presigned URL** — a temporary, signed URL granting limited access to a private object.
- **Egress** — outbound bandwidth (often the main cost driver).
- **CDN / edge / POP** — caching servers near users for speed + origin offload.
- **CORS** — the browser rule that an origin must permit cross-origin fetches.
- **Worker** — a small serverless function (here, Cloudflare) that runs our signing logic.
- **wrangler** — Cloudflare's CLI for deploying Workers and managing R2.

---

## 9. Exact setup: Cloudflare R2 for this project

> You'll do these once. Anything that needs a secret is marked 🔑. The agent can do
> the code/config parts; the account/billing/DNS parts are yours (or delegate with a
> scoped API token).

### 9.1 Create the bucket
1. Sign in at Cloudflare → **R2** → **Create bucket** → name it **`lufs-catalog`**.
   (R2 requires a card on file even though usage here is near-free.)
2. We'll use prefixes inside it: `releases/`, `reports/`, `artwork/`.

### 9.2 Make `reports/` and `artwork/` reachable publicly
- Easiest: enable the bucket's **r2.dev** public URL (gives `https://pub-xxxx.r2.dev/...`).
- Better long-term: attach a **custom domain** (e.g. `cdn.lufs.audio`) to the bucket
  for public objects — nicer URLs + edge caching under your name. (DNS step.)
- Keep `releases/` **private** (do not expose it publicly — it's signed-URL only).

### 9.3 Create an API token 🔑
- R2 → **Manage R2 API Tokens** → **Create** → permission **Object Read & Write**,
  scoped to the `lufs-catalog` bucket.
- You get: **Access Key ID**, **Secret Access Key**, and an **endpoint**
  `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Save them somewhere safe.

### 9.4 Put credentials in `.env` (gitignored) 🔑
```bash
# .env.production  (NEVER commit)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=lufs-catalog
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev      # or https://cdn.lufs.audio
PUBLIC_STREAM_WORKER_URL=https://stream.lufs.audio
R2_MODE=true
```

### 9.5 Configure CORS
- R2 bucket → **Settings** → **CORS policy** → paste the JSON from §7.
  (Or `wrangler r2 bucket cors put lufs-catalog --file cors.json`.)

### 9.6 Deploy the signing Worker 🔑
1. Install the CLI: `npm i -g wrangler` then `wrangler login`.
2. From `worker/`: set secrets (not in `wrangler.toml`):
   ```bash
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   wrangler secret put R2_ACCOUNT_ID
   # plus vars: R2_BUCKET_NAME, ALLOWED_ORIGIN=https://catalog.lufs.audio
   ```
3. `wrangler deploy`. Map it to a route/subdomain → **`stream.lufs.audio`** (DNS step).
4. Put that URL in `PUBLIC_STREAM_WORKER_URL`.

### 9.7 Verify
- Upload a test object (the ingest will do this, or `wrangler r2 object put`).
- Hit `https://stream.lufs.audio?key=releases/<...>.mp3` from the site → expect a JSON
  `{ url }`; from a random origin → expect `403` (CORS/Origin check working).
- Load the site → audio plays; **view source / network tab → no R2 key, no secret**.

### 9.8 Cost guardrails (optional, recommended)
- Cloudflare → **Notifications**: set a billing/usage alert.
- Remember: storage + operations cost a little; **egress is \$0**. At this scale
  expect single-digit cents to low dollars per month.

---

## 10. How our code uses all this (recap)

- **Ingest** (`uploadR2.mjs`) uses the AWS S3 SDK with the R2 endpoint to **PUT**
  audio (private), reports + artwork (public).
- **Worker** uses the SDK + `@aws-sdk/s3-request-presigner` to **sign GETs** for
  `releases/` keys, CORS-locked to the site.
- **Player** (`useHowler.ts`) fetches a signed URL from the Worker, then streams.
- **Public assets** are referenced by their public R2 URL directly (no signing).
- **Fallback** (doc 07) swaps the endpoint to the NAS rustfs S3 service when enabled.

That's the whole mental model: *files in a bucket, keys not folders, public vs
private, sign the private ones, let the edge cache do the rest, and never pay for
egress.*

---

## 11. The R2 ↔ rustfs switch (centralized in `.env`)

Because S3 is a *standard*, swapping storage providers is mostly an endpoint +
credentials change. We expose that as a deliberate switch in one place — the
`.env.production` file (template: `.env.production.example`):

| Var | Values | Meaning |
|---|---|---|
| `STORAGE_MODE` | `local` \| `remote` | `local` serves from `public/` (no cloud); `remote` uses object storage |
| `STORAGE_PRIMARY` | `r2` \| `rustfs` | **the switch** — which origin the site serves from |
| `STORAGE_MIRROR` | `none` \| `r2` \| `rustfs` | also upload a second copy on ingest (dual-write) |
| `STREAM_FALLBACK_ENABLED` | `true` \| `false` | auto fail over to the other origin if a fetch fails |

You don't hand-edit this for the common case — the opencode agent (doc 08) or the
helper script does it safely:

```bash
./scripts/catalog-set-origin.sh rustfs   # point production at the NAS
./scripts/catalog-set-origin.sh r2       # back to Cloudflare
./scripts/catalog-config.sh              # show the effective config (secrets masked)
```

`catalog-set-origin.sh` refuses to switch to `rustfs` until `RUSTFS_ENDPOINT` is
configured (so you can't point production at a NAS that isn't up yet). Full design +
the stand-up checklist live in [`07-nas-rustfs-fallback.md`](./07-nas-rustfs-fallback.md).
