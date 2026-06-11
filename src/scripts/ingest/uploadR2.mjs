/**
 * uploadR2.mjs — upload helper for catalog-ingest.mjs (STORAGE_MODE=remote).
 *
 * Audio (web-ready MP3) goes to the PRIVATE bucket (R2_BUCKET_NAME) under releases/…,
 * streamed via short-lived presigned URLs from the signing Worker. Public assets (cover
 * art + the proof-of-work report and its images/video) go to the PUBLIC bucket
 * (R2_PUBLIC_BUCKET_NAME) and are served directly from PUBLIC_R2_BASE_URL (e.g.
 * cdn.lufsaud.io) — pass { bucket } to target it. Nothing heavy is committed to git.
 *
 * Env (server/script only — never in the browser bundle):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 *   R2_PUBLIC_BUCKET_NAME, R2_ENDPOINT.  (STORAGE_MIRROR=rustfs + RUSTFS_* → doc 07.)
 *
 * Requires `@aws-sdk/client-s3` (root dependency). `pnpm install` after pulling.
 */
import { readFileSync } from 'node:fs';

const warn = (...a) => console.warn('  ⚠', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let S3Client; let PutObjectCommand; let HeadObjectCommand;
try {
  ({ S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3'));
} catch {
  // Loaded lazily so local-mode ingest doesn't require the dependency.
}

function r2Client() {
  if (!S3Client) throw new Error('@aws-sdk/client-s3 not installed — run `pnpm install` (needed for STORAGE_MODE=remote).');
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// --- NAS rustfs mirror (disabled until STORAGE_MIRROR=rustfs and RUSTFS_* set) ---
// function rustfsClient() {
//   return new S3Client({
//     region: 'auto',
//     endpoint: process.env.RUSTFS_ENDPOINT,
//     forcePathStyle: true, // rustfs/MinIO-style endpoints usually need path-style
//     credentials: {
//       accessKeyId: process.env.RUSTFS_ACCESS_KEY_ID,
//       secretAccessKey: process.env.RUSTFS_SECRET_ACCESS_KEY,
//     },
//   });
// }

let _r2 = null;
// let _rustfs = null;

/**
 * Upload a local file to R2 (and optionally mirror to rustfs). Returns the key.
 *
 * Targets the PRIVATE audio bucket (R2_BUCKET_NAME) by default; pass { bucket } to
 * target another bucket — e.g. the PUBLIC bucket (R2_PUBLIC_BUCKET_NAME) for cover art
 * and the proof-of-work report served from PUBLIC_R2_BASE_URL. `metadata` is stored as
 * x-amz-meta-* (keys come back lowercased).
 */
export async function uploadObject(localPath, key, contentType = 'application/octet-stream', { bucket, metadata = {} } = {}) {
  _r2 = _r2 || r2Client();
  const Bucket = bucket || process.env.R2_BUCKET_NAME;
  const Body = readFileSync(localPath);
  // Metadata values must be strings; stored as x-amz-meta-* (keys come back lowercased).
  const meta = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v ?? '')]));
  const cmd = new PutObjectCommand({
    Bucket, Key: key, Body, ContentType: contentType, Metadata: meta,
  });
  // Retry transient R2 errors (5xx / rate-limit / an HTML error page the SDK can't
  // deserialize) with backoff, so one blip doesn't drop a track.
  const attempts = Number(process.env.R2_UPLOAD_ATTEMPTS) || 3;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { await _r2.send(cmd); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      if (i < attempts) { warn(`R2 upload retry ${i}/${attempts - 1} for ${key}: ${e.message}`); await sleep(400 * i); }
    }
  }
  if (lastErr) throw new Error(`R2 upload failed after ${attempts} attempts for ${key}: ${lastErr.message}`);
  console.log(`    ↑ R2  ${key}`);

  // --- rustfs mirror (commented until the NAS endpoint is stood up — see doc 07) ---
  // if (process.env.STORAGE_MIRROR === 'rustfs' || process.env.STORAGE_PRIMARY === 'rustfs') {
  //   _rustfs = _rustfs || rustfsClient();
  //   try {
  //     await _rustfs.send(new PutObjectCommand({
  //       Bucket: process.env.RUSTFS_BUCKET_NAME, Key: key, Body, ContentType: contentType,
  //     }));
  //     console.log(`    ↑ rustfs  ${key}`);
  //   } catch (err) {
  //     console.warn(`    ⚠ rustfs mirror failed for ${key}: ${err.message}`);
  //   }
  // }

  return key;
}

/**
 * HEAD an object to support skip-if-unchanged. Returns { metadata, contentLength }
 * or null if the object doesn't exist. Pass { bucket } to target a non-default bucket
 * (e.g. the public covers/reports bucket). `metadata` keys are lowercased by S3/R2.
 */
export async function headObjectMeta(key, { bucket } = {}) {
  if (!HeadObjectCommand) return null;
  _r2 = _r2 || r2Client();
  try {
    const r = await _r2.send(new HeadObjectCommand({ Bucket: bucket || process.env.R2_BUCKET_NAME, Key: key }));
    return { metadata: r.Metadata || {}, contentLength: r.ContentLength };
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey') return null;
    throw e; // real error (auth/network) — let the caller decide
  }
}

export const isAvailable = () => !!S3Client;
