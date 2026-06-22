/**
 * lufs-catalog-stream — Cloudflare Worker. Two jobs:
 *
 *  1. (legacy, unchanged) Mint short-lived presigned GET URLs for PRIVATE R2 audio objects,
 *     for the catalog site's own player:
 *       GET https://stream.lufsaud.io/?key=releases/<collection>/<n>/<file>.mp3
 *       → { "url": "<presigned>", "expiresIn": 3600 }   (origin-locked, JSON)
 *
 *  2. (new) A public, human-addressable stream API that works as a plain media `src`,
 *     so any <audio> / Web Audio graph across the LUFS ecosystem can play catalog tracks:
 *       GET https://stream.lufsaud.io/api/stream/<id>            → 302 → fresh presigned URL
 *       GET https://stream.lufsaud.io/api/stream/<id>?format=json → { url, expiresIn, id, ... }
 *     where <id> is the catalogNumber ("lufs-XXXXXXXX"), "{collection}/{slug}", or an
 *     unambiguous bare slug — resolved against /stream-manifest.json (see resolve.ts).
 *
 * The public route defaults to permissive CORS because embedding is the explicit goal; the
 * legacy ?key= path stays origin-locked. NOTE: the audio BYTES are served by R2 after the
 * 302, so a cross-origin AnalyserNode also needs the R2 bucket CORS policy (worker/r2-cors.json)
 * — the Worker's CORS headers do not carry to the R2 response.
 *
 * Secrets (wrangler secret put): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * Vars (wrangler.toml): ALLOWED_ORIGIN, R2_BUCKET_NAME, URL_TTL_SECONDS, MANIFEST_URL, MANIFEST_TTL_SECONDS
 */
import { AwsClient } from 'aws4fetch';
import { resolveStreamId, type ManifestTrack } from './resolve';
import { loadManifest } from './manifest';

export interface Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  ALLOWED_ORIGIN: string; // comma-separated allowlist for the legacy ?key= path
  URL_TTL_SECONDS?: string;
  MANIFEST_URL?: string; // e.g. "https://catalog.lufs.audio/stream-manifest.json"
  MANIFEST_TTL_SECONDS?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Origin-echoing CORS for the legacy, origin-locked ?key= path. */
function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/** Permissive CORS for the public /api/stream/* routes (embeddable anywhere). */
function publicCors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  };
}

function ttlOf(env: Env): number {
  return Math.min(parseInt(env.URL_TTL_SECONDS || '3600', 10) || 3600, 86400);
}

/** Presign an S3 GET against R2 for a private object key. */
async function presign(env: Env, key: string, ttl: number): Promise<string> {
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: 'auto',
    service: 's3',
  });
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodedKey}`;
  const signed = await aws.sign(`${base}?X-Amz-Expires=${ttl}`, { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

/** Turn a resolved manifest track into a playable URL (presign R2 keys; pass direct urls). */
async function urlForTrack(env: Env, track: ManifestTrack, ttl: number): Promise<string> {
  if (track.url) return track.url;
  if (track.key && track.key.startsWith('releases/') && !track.key.includes('..')) {
    return presign(env, track.key, ttl);
  }
  throw new Error('track has no playable source');
}

// ---- legacy ?key= handler (unchanged behavior) ------------------------------------------
async function handleKeySign(request: Request, env: Env): Promise<Response> {
  const allow = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const echo = allow.includes(origin) ? origin : (allow[0] || '');

  if (allow.length && origin && !allow.includes(origin)) {
    return new Response('Forbidden origin', { status: 403, headers: cors(echo) });
  }
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith('releases/') || key.includes('..')) {
    return new Response('Forbidden key', { status: 403, headers: cors(echo) });
  }
  const ttl = ttlOf(env);
  try {
    const url = await presign(env, key, ttl);
    return new Response(JSON.stringify({ url, expiresIn: ttl }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...cors(echo) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'sign_failed', message: String((err as Error)?.message || err) }), {
      status: 500, headers: { ...JSON_HEADERS, ...cors(echo) },
    });
  }
}

// ---- new public /api/stream/<id> handler ------------------------------------------------
async function handleStream(request: Request, env: Env, id: string): Promise<Response> {
  const url = new URL(request.url);
  const wantJson = url.searchParams.get('format') === 'json';
  const cc = publicCors();

  if (!env.MANIFEST_URL) {
    return new Response(JSON.stringify({ error: 'no_manifest', message: 'MANIFEST_URL not configured' }), {
      status: 503, headers: { ...JSON_HEADERS, ...cc },
    });
  }

  let manifest;
  try {
    manifest = await loadManifest(env.MANIFEST_URL, parseInt(env.MANIFEST_TTL_SECONDS || '300', 10) || 300);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'manifest_unavailable', message: String((err as Error)?.message || err) }), {
      status: 502, headers: { ...JSON_HEADERS, ...cc },
    });
  }

  const r = resolveStreamId(manifest, id);
  if (!r.ok) {
    const status = r.error === 'ambiguous' ? 409 : 404;
    return new Response(JSON.stringify({
      error: r.error,
      message: r.error === 'ambiguous'
        ? 'Slug matches multiple tracks; use the catalogNumber or "{collection}/{slug}".'
        : 'No track matches that id.',
      candidates: r.candidates?.map((c) => ({ id: c.id, title: c.title, collection: c.collection })),
    }), { status, headers: { ...JSON_HEADERS, ...cc } });
  }

  const ttl = ttlOf(env);
  let playable: string;
  try {
    playable = await urlForTrack(env, r.track, ttl);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'sign_failed', message: String((err as Error)?.message || err) }), {
      status: 500, headers: { ...JSON_HEADERS, ...cc },
    });
  }

  if (wantJson) {
    return new Response(JSON.stringify({
      url: playable, expiresIn: r.track.url ? null : ttl,
      id: r.track.id, title: r.track.title, collection: r.track.collection,
      cover: r.track.cover ?? null, duration: r.track.duration ?? null,
    }), { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...cc } });
  }

  // Default: 302 so the route works as a plain media src (the browser follows to R2 and
  // issues range requests there). Never cache the redirect — the target URL is short-lived.
  return new Response(null, {
    status: 302,
    headers: { Location: playable, 'Cache-Control': 'no-store', ...cc },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: publicCors() });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: publicCors() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Public stream API: /api/stream/<id> (id may contain a "/" for {collection}/{slug}).
    const m = path.match(/^\/api\/stream\/(.+)$/);
    if (m) return handleStream(request, env, m[1]);

    // Legacy signing path: /?key=releases/...
    if (path === '/' || path === '') return handleKeySign(request, env);

    return new Response('Not Found', { status: 404, headers: publicCors() });
  },
};
