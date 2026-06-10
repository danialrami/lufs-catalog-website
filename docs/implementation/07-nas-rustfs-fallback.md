# 07 — NAS rustfs: Alternative Origin + Fallback

**Goal:** give the catalog a **second origin you control** — an S3-compatible
**rustfs** server on the NAS — that can be used two ways:

1. **As a deliberate switch** — flip `STORAGE_PRIMARY=rustfs` to make the NAS the
   thing production serves from (e.g. if you ever don't want to pay Cloudflare, or
   want full sovereignty). One command: `./scripts/catalog-set-origin.sh rustfs`.
2. **As an automatic fallback** — with `STREAM_FALLBACK_ENABLED=true`, the player and
   report loader retry against the NAS if the primary (R2) errors out.

Either way the ingest can keep a **second copy** of every asset there
(`STORAGE_MIRROR=rustfs`).

**Status:** designed now; **implemented but commented/flagged off** until Daniel
stands up rustfs + a public, TLS reverse proxy. Nothing here is enabled by default,
and the switch script refuses to point production at rustfs until `RUSTFS_ENDPOINT`
is configured.

> Note: the headline R2 fees are tiny (see `06-cdn-and-s3-guide.md` §6 — basically
> just storage above 10 GB, with **zero egress**). So the *practical* reasons to use
> rustfs are resilience, sovereignty, and avoiding a card-on-file — not big savings.
> The switch exists so that choice is always yours.

---

## 1. What rustfs is, and why it fits

[rustfs](https://github.com/rustfs/rustfs) is a self-hostable, **S3-compatible**
object storage server (same role as MinIO). Because it speaks the S3 API, our
existing upload/sign code works against it by **only changing the endpoint +
credentials** (see doc 06 §2). That's the whole reason a clean fallback is possible
without a second codebase.

On the NAS it gives us:
- a **mirror** of the same `lufs-catalog` bucket layout (`releases/`, `reports/`, `artwork/`),
- a copy of the data we fully own (sovereignty + a real second home), and
- a working origin when the primary (R2) is down.

---

## 2. Topology

```
            ┌─────────────── primary path ───────────────┐
Browser ──► Cloudflare edge / Worker ──► R2 (lufs-catalog)  │
   │                                                       │
   │  on failure (network error / 5xx / timeout)           │
   └──────► NAS reverse proxy (TLS) ──► rustfs S3 ─────────┘
            e.g. https://s3.lufs.audio        (mirror of lufs-catalog)
```

Two integration points:
1. **Ingest dual-write** — after uploading to R2, upload the same key to rustfs.
2. **Client failover** — if fetching from R2/Worker fails, retry against rustfs.

---

## 3. ⚠️ The subtle gotcha: don't route the fallback through Cloudflare

If the public path to the NAS is a **Cloudflare Tunnel** (or any Cloudflare-proxied
DNS), then *"Cloudflare is down"* also takes down your fallback — defeating the point.
For genuine independence, expose the NAS via a **non-Cloudflare** path:

- **Caddy** (or nginx) on the NAS/edge box + **Let's Encrypt** TLS + a **DDNS**
  hostname (e.g. `s3.lufs.audio` pointing at your home IP, DNS hosted somewhere that
  isn't the thing you're failing away from). Requires a port-forward (443).
- **Tailscale Funnel** — public HTTPS to a tailnet service without opening ports;
  independent of Cloudflare.

Pick whichever you're comfortable operating. Caddy + DDNS is the most "standard web"
and keeps the fallback fully independent. Document the final choice here once chosen.

> Also note: presigning for rustfs needs the rustfs credentials. The cleanest
> approach is a **second tiny signing endpoint co-located with rustfs** (same Worker
> code, different env), OR make the fallback audio path rely on the reverse proxy +
> short-lived signed paths. For v1 fallback we can even serve `releases/` from rustfs
> as **proxy-protected** (auth at Caddy) and accept a slightly weaker protection
> *only while the primary is down*. Decide at enable-time.

---

## 4. Config (centralized in `.env.production`, all OFF by default)

The switch + fallback share the same centralized block as R2 (see
`.env.production.example`). The rustfs half stays commented until the endpoint exists:

```bash
# ─── Storage switch ───
STORAGE_MODE=remote
STORAGE_PRIMARY=r2               # flip to rustfs to serve from the NAS
STORAGE_MIRROR=none              # set to rustfs to dual-write a 2nd copy on ingest
STREAM_FALLBACK_ENABLED=false    # true = auto fail over to the other origin

# ─── NAS rustfs (commented until stood up) ───
# RUSTFS_ACCESS_KEY_ID=
# RUSTFS_SECRET_ACCESS_KEY=
# RUSTFS_BUCKET_NAME=lufs-catalog
# RUSTFS_ENDPOINT=https://s3.lufs.audio
# PUBLIC_RUSTFS_BASE_URL=https://s3.lufs.audio            # public reports/artwork mirror
# PUBLIC_RUSTFS_STREAM_URL=https://stream-nas.lufs.audio  # optional 2nd signer for private audio
```

`PUBLIC_*` vars are browser-safe (used by the player to fail over / when rustfs is
primary). The credentials are server/Worker-only, exactly like the R2 ones. Operate
the switch with `./scripts/catalog-set-origin.sh <r2|rustfs>` rather than hand-editing.

---

## 5. Ingest dual-write (commented stub for `uploadR2.mjs`)

This lands (commented) when we build `uploadR2.mjs` in Phase 2. The primary upload is
unchanged; the mirror is best-effort and never blocks a release.

```javascript
// src/scripts/ingest/uploadR2.mjs
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// --- NAS rustfs client (disabled until STORAGE_MIRROR=rustfs or STORAGE_PRIMARY=rustfs) ---
// let rustfs = null;
// if (process.env.STORAGE_MIRROR === 'rustfs' || process.env.STORAGE_PRIMARY === 'rustfs') {
//   rustfs = new S3Client({
//     region: 'auto',
//     endpoint: process.env.RUSTFS_ENDPOINT,
//     forcePathStyle: true, // rustfs/MinIO-style endpoints usually need path-style
//     credentials: {
//       accessKeyId: process.env.RUSTFS_ACCESS_KEY_ID,
//       secretAccessKey: process.env.RUSTFS_SECRET_ACCESS_KEY,
//     },
//   });
// }

export async function uploadObject(localPath, key, contentType = 'audio/mpeg') {
  const Body = readFileSync(localPath);

  // 1) Primary: Cloudflare R2 (required)
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body, ContentType: contentType,
  }));
  console.log(`  ✓ R2 ← ${key}`);

  // 2) Fallback mirror: NAS rustfs (best-effort; never fails the release)
  // if (rustfs) {
  //   try {
  //     await rustfs.send(new PutObjectCommand({
  //       Bucket: process.env.RUSTFS_BUCKET_NAME, Key: key, Body, ContentType: contentType,
  //     }));
  //     console.log(`  ✓ rustfs ← ${key}`);
  //   } catch (err) {
  //     console.warn(`  ⚠ rustfs mirror failed for ${key}: ${err.message}`);
  //   }
  // }
}
```

---

## 6. Client failover (commented stub for `useHowler.ts`)

Lands (commented) when we wire the player in Phase 2. Try the primary signer; on
failure, try the NAS signer/endpoint.

```typescript
// src/components/player/useHowler.ts
async function resolveStreamUrl(r2Key: string): Promise<string> {
  const primary = import.meta.env.PUBLIC_STREAM_WORKER_URL;
  try {
    const res = await fetch(`${primary}?key=${encodeURIComponent(r2Key)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`primary ${res.status}`);
    return (await res.json()).url;
  } catch (err) {
    // --- NAS fallback (disabled until STREAM_FALLBACK_ENABLED + rustfs configured) ---
    // const fb = import.meta.env.PUBLIC_RUSTFS_STREAM_URL;
    // if (fb) {
    //   const res = await fetch(`${fb}?key=${encodeURIComponent(r2Key)}`);
    //   if (res.ok) return (await res.json()).url;
    // }
    throw err;
  }
}
```

For **public** assets (reports/artwork), the equivalent is: try
`PUBLIC_R2_BASE_URL/<key>`; `onerror`, swap to `PUBLIC_RUSTFS_BASE_URL/<key>`. A
tiny `withFallback(url)` helper on `<img>`/`<iframe>` covers it.

---

## 7. Stand-up checklist (when Daniel is ready)

1. Install rustfs on the NAS; create bucket `lufs-catalog`; create access keys.
2. Choose + configure a **non-Cloudflare** public TLS path (Caddy + DDNS, or
   Tailscale Funnel) → e.g. `https://s3.lufs.audio`.
3. (Optional) deploy a second signing endpoint for private audio failover.
4. Backfill: mirror existing R2 objects to rustfs once (`rclone sync r2:lufs-catalog
   rustfs:lufs-catalog` — `rclone` speaks both S3 endpoints).
5. Fill the rustfs `.env` vars; set `STREAM_FALLBACK_ENABLED=true` and/or
   `STORAGE_MIRROR=rustfs`. To make rustfs the *primary* origin:
   `./scripts/catalog-set-origin.sh rustfs`.
6. **Uncomment** the stubs in `uploadR2.mjs` and `useHowler.ts` (+ the public-asset
   `withFallback`).
7. Test: temporarily block R2 (e.g. bad Worker URL in a staging build) and confirm
   playback + images fall back to the NAS.
8. Update doc 06/07 with the final hostnames and the chosen protection model.

---

## 8. Why this is worth doing (and worth gating)

- **Worth doing:** a second origin you control turns "Cloudflare outage" and "vendor
  lock-in" from existential worries into a shrug. It also gives the archive a live,
  queryable second copy.
- **Worth gating:** until the reverse proxy + TLS exist, enabling it would just add
  failing uploads and dead failover paths. So it ships **commented**, with a crisp
  switch-on checklist — zero cost now, fast to enable later.
