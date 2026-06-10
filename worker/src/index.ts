/**
 * lufs-catalog-stream — Cloudflare Worker that mints short-lived presigned GET
 * URLs for PRIVATE audio objects in the R2 bucket. The site never holds a durable
 * URL or the R2 key's signature; the browser asks this Worker per play.
 *
 * Uses aws4fetch (tiny, Workers-native) to presign against R2's S3 endpoint — no
 * heavy AWS SDK, no nodejs_compat needed.
 *
 * Request:  GET https://stream.lufs.audio/?key=releases/<collection>/<n>/<file>.mp3
 * Response: { "url": "<presigned-url>", "expiresIn": 3600 }
 *
 * Secrets (wrangler secret put): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * Vars (wrangler.toml):          ALLOWED_ORIGIN, R2_BUCKET_NAME, URL_TTL_SECONDS
 */
import { AwsClient } from 'aws4fetch';

export interface Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  ALLOWED_ORIGIN: string; // comma-separated allowlist, e.g. "https://catalog.lufs.audio,http://localhost:4321"
  URL_TTL_SECONDS?: string;
}

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allow = (env.ALLOWED_ORIGIN || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const echo = allow.includes(origin) ? origin : (allow[0] || '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(echo) });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: cors(echo) });
    }
    // Origin gate (browsers enforce CORS anyway; this is a cheap extra check).
    if (allow.length && origin && !allow.includes(origin)) {
      return new Response('Forbidden origin', { status: 403, headers: cors(echo) });
    }

    const key = new URL(request.url).searchParams.get('key') || '';
    // Only ever sign private release audio. No path traversal.
    if (!key.startsWith('releases/') || key.includes('..')) {
      return new Response('Forbidden key', { status: 403, headers: cors(echo) });
    }

    const ttl = Math.min(parseInt(env.URL_TTL_SECONDS || '3600', 10) || 3600, 86400);
    const aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      region: 'auto',
      service: 's3',
    });

    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodedKey}`;

    try {
      const signed = await aws.sign(`${base}?X-Amz-Expires=${ttl}`, {
        method: 'GET',
        aws: { signQuery: true },
      });
      return new Response(JSON.stringify({ url: signed.url, expiresIn: ttl }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(echo) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'sign_failed', message: String((err as Error)?.message || err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors(echo) },
      });
    }
  },
};
