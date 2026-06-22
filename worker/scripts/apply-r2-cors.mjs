/**
 * apply-r2-cors.mjs — apply worker/r2-cors.json to the R2 bucket via the S3 PutBucketCors API.
 *
 * WHY THIS EXISTS: the public /api/stream route 302-redirects to a presigned R2 URL, so the
 * audio BYTES are served by R2 — not the Worker. For a cross-origin AnalyserNode (the resume
 * + lufs.audio reactive backgrounds) to READ that audio, the R2 response must carry CORS
 * headers; otherwise the buffer is tainted and the analyser reads silence ("exit 0 but
 * wrong"). This makes that config reproducible instead of a dashboard click no one remembers.
 *
 * Run on a trusted machine (NOT in CI logs — it reads secrets from env):
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET_NAME=lufs-catalog \
 *     node scripts/apply-r2-cors.mjs [--get]
 *
 * --get  : print the bucket's current CORS config instead of writing.
 *
 * Uses @aws-sdk/client-s3 (already a project dependency).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const here = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(join(here, '..', 'r2-cors.json'), 'utf8'));

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const get = process.argv.includes('--get');

try {
  if (get) {
    const res = await s3.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET_NAME }));
    console.log(JSON.stringify(res.CORSRules ?? [], null, 2));
  } else {
    await s3.send(new PutBucketCorsCommand({
      Bucket: R2_BUCKET_NAME,
      CORSConfiguration: { CORSRules: rules },
    }));
    console.log(`✓ applied ${rules.length} CORS rule(s) to R2 bucket "${R2_BUCKET_NAME}"`);
    console.log('  Verify a real stream reads non-zero analyser data cross-origin before calling this done.');
  }
} catch (err) {
  console.error('CORS operation failed:', err?.message || err);
  process.exit(1);
}
