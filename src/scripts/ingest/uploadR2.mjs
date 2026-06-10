/**
 * uploadR2.mjs — upload helper for catalog-ingest.mjs (STORAGE_MODE=remote).
 *
 * Uploads the web-ready MP3 to the PRIVATE R2 bucket under releases/… ; the site
 * streams it via short-lived presigned URLs from the signing Worker. Small assets
 * (report HTML, cover thumbnails) are NOT uploaded here — they stay committed in
 * public/ and deploy with the site (cacheable, zero-egress, simplest).
 *
 * Env (server/script only — never in the browser bundle):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT
 *   STORAGE_MIRROR=rustfs + RUSTFS_* to also mirror to the NAS (see doc 07).
 *
 * Requires `@aws-sdk/client-s3` (root dependency). `pnpm install` after pulling.
 */
import { readFileSync } from 'node:fs';

let S3Client; let PutObjectCommand;
try {
  ({ S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3'));
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
 */
export async function uploadObject(localPath, key, contentType = 'application/octet-stream') {
  _r2 = _r2 || r2Client();
  const Body = readFileSync(localPath);
  await _r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body, ContentType: contentType,
  }));
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

export const isAvailable = () => !!S3Client;
