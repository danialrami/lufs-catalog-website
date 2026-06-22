/**
 * lufs-catalog-stream — Cloudflare Worker. Three jobs:
 *
 *  1. (legacy, unchanged) Mint short-lived presigned GET URLs for PRIVATE R2 audio objects,
 *     for the catalog site's own player:
 *       GET https://stream.lufsaud.io/?key=releases/<collection>/<n>/<file>.mp3
 *       → { "url": "<presigned>", "expiresIn": 3600 }   (origin-locked, JSON)
 *
 *  2. A public, human-addressable stream API that works as a plain media `src`:
 *       GET https://stream.lufsaud.io/api/stream/<id>            → 302 → fresh presigned URL
 *       GET https://stream.lufsaud.io/api/stream/<id>?format=json → { url, expiresIn, id, ... }
 *     <id> = catalogNumber ("lufs-XXXXXXXX"), "{collection}/{slug}", or unambiguous bare slug.
 *
 *  3. oEmbed discovery so a pasted catalog link auto-unfurls into the iframe player:
 *       GET https://stream.lufsaud.io/api/oembed?url=<release-or-embed-url>&format=json
 *       → { version, type:"rich", html:"<iframe …/embed/<id>>", title, thumbnail_url, ... }
 *
 * The public routes default to permissive CORS (embedding is the goal); the legacy ?key=
 * path stays origin-locked. NOTE: audio BYTES are served by R2 after the 302, so a
 * cross-origin AnalyserNode also needs the R2 bucket CORS policy (worker/r2-cors.json).
 *
 * Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * Vars: ALLOWED_ORIGIN, R2_BUCKET_NAME, URL_TTL_SECONDS, MANIFEST_URL, MANIFEST_TTL_SECONDS, EMBED_BASE
 */
import { AwsClient } from 'aws4fetch';
import { resolveStreamId, firstTrackOfRelease, type ManifestTrack, type StreamManifest } from './resolve';
import { loadManifest } from './manifest';

export interface Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  ALLOWED_ORIGIN: string;
  URL_TTL_SECONDS?: string;
  MANIFEST_URL?: string;
  MANIFEST_TTL_SECONDS?: string;
  EMBED_BASE?: string; // e.g. "https://catalog.lufs.audio"
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EMBED_DEFAULT_W = 456;
const EMBED_DEFAULT_H = 152;

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

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

async function urlForTrack(env: Env, track: ManifestTrack, ttl: number): Promise<string> {
  if (track.url) return track.url;
  if (track.key && track.key.startsWith('releases/') && !track.key.includes('..')) {
    return presign(env, track.key, ttl);
  }
  throw new Error('track has no playable source');
}

async function getManifest(env: Env): Promise<StreamManifest> {
  if (!env.MANIFEST_URL) throw new Error('MANIFEST_URL not configured');
  return loadManifest(env.MANIFEST_URL, parseInt(env.MANIFEST_TTL_SECONDS || '300', 10) || 300);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
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

// ---- public /api/stream/<id> handler ----------------------------------------------------
async function handleStream(request: Request, env: Env, id: string): Promise<Response> {
  const url = new URL(request.url);
  const wantJson = url.searchParams.get('format') === 'json';
  const cc = publicCors();

  let manifest: StreamManifest;
  try {
    manifest = await getManifest(env);
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

  return new Response(null, {
    status: 302,
    headers: { Location: playable, 'Cache-Control': 'no-store', ...cc },
  });
}

// ---- /api/oembed handler ----------------------------------------------------------------
function clampDim(v: string | null, def: number): number {
  const n = parseInt(v || '', 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Map an oEmbed `url` (an /embed/<id> or /releases/<slug> link) to a manifest track. */
function trackForOembedUrl(manifest: StreamManifest, target: string): ManifestTrack | null {
  let path: string;
  try { path = new URL(target).pathname; } catch { return null; }

  const embedM = path.match(/\/embed\/([^/]+)\/?$/);
  if (embedM) {
    const r = resolveStreamId(manifest, decodeURIComponent(embedM[1]));
    return r.ok ? r.track : null;
  }
  const relM = path.match(/\/releases\/([^/]+)\/?$/);
  if (relM) return firstTrackOfRelease(manifest, decodeURIComponent(relM[1]));
  return null;
}

async function handleOembed(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cc = publicCors();

  const format = url.searchParams.get('format');
  if (format && format !== 'json') {
    // oEmbed: signal unsupported formats (we only emit JSON, not XML).
    return new Response('Only json format is supported', { status: 501, headers: cc });
  }
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'missing_url' }), { status: 400, headers: { ...JSON_HEADERS, ...cc } });
  }

  let manifest: StreamManifest;
  try { manifest = await getManifest(env); }
  catch (err) {
    return new Response(JSON.stringify({ error: 'manifest_unavailable', message: String((err as Error)?.message || err) }), {
      status: 502, headers: { ...JSON_HEADERS, ...cc },
    });
  }

  const track = trackForOembedUrl(manifest, target);
  if (!track) {
    return new Response(JSON.stringify({ error: 'not_found', message: 'No catalog track for that url.' }), {
      status: 404, headers: { ...JSON_HEADERS, ...cc },
    });
  }

  const embedBase = (env.EMBED_BASE || 'https://catalog.lufs.audio').replace(/\/$/, '');
  const width = Math.min(clampDim(url.searchParams.get('maxwidth'), EMBED_DEFAULT_W), 900);
  const height = Math.min(clampDim(url.searchParams.get('maxheight'), EMBED_DEFAULT_H), 400);
  const embedUrl = `${embedBase}/embed/${encodeURIComponent(track.id)}`;
  // Responsive iframe: width="100%" capped by max-width so a pasted embed never forces
  // horizontal scroll on a narrow host. The numeric width/height below stay as oEmbed
  // sizing hints (the spec wants integers); only the rendered iframe is fluid.
  const html =
    `<iframe src="${escapeHtml(embedUrl)}" width="100%" height="${height}" ` +
    `frameborder="0" loading="lazy" allow="autoplay; encrypted-media" ` +
    `style="border:none;overflow:hidden;border-radius:14px;max-width:${width}px" title="${escapeHtml(track.title)}"></iframe>`;

  return new Response(JSON.stringify({
    version: '1.0',
    type: 'rich',
    provider_name: 'LUFS Catalog',
    provider_url: embedBase,
    title: track.title,
    author_name: 'LUFS Audio',
    author_url: embedBase,
    thumbnail_url: track.cover ?? undefined,
    width,
    height,
    html,
  }), { headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=300', ...cc } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: publicCors() });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: publicCors() });
    }

    const path = new URL(request.url).pathname;

    if (path === '/api/oembed') return handleOembed(request, env);

    const m = path.match(/^\/api\/stream\/(.+)$/);
    if (m) return handleStream(request, env, m[1]);

    if (path === '/' || path === '') return handleKeySign(request, env);

    return new Response('Not Found', { status: 404, headers: publicCors() });
  },
};
