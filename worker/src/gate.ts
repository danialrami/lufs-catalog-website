/**
 * gate.ts — pure, dependency-free request-gating + presign helpers for the public
 * `/api/stream/<id>` route. Kept free of Workers globals so it unit-tests without a
 * Workers runtime, exactly like `resolve.ts`.
 *
 * WHY THIS EXISTS: the public stream route is intentionally CORS-open so catalog audio can
 * be embedded as a plain `<audio src>` on our sibling sites (resume.danialrami.com,
 * lufs.audio) and drive their Web Audio `AnalyserNode` visualizers. But "CORS-open" also
 * meant "anyone who pastes the URL in a browser gets the raw MP3" — a direct-navigation
 * download hole (found 2026-06-22). These helpers restore proportionate friction WITHOUT
 * breaking legitimate embeds:
 *
 *   - `isEmbedAllowed()` — allow same-site, allow cross-site from an allow-listed LUFS host,
 *     deny direct address-bar navigation (`Sec-Fetch-Site: none`) and foreign hotlinks.
 *     Soft (Referer/Sec-Fetch are curl-spoofable) but it kills the casual vector, which is
 *     the right bar for a small catalog. The hard control (HMAC tokens / byte proxying) is
 *     Phase 2 — see the agent-knowledge `catalog-embedding/06-stream-protection` doc.
 *   - `presignParams()` — force `Content-Disposition: inline` + a correct `Content-Type` on
 *     the presigned R2 GET so the browser PLAYS rather than offering a download dialog. R2
 *     honors these S3 response-override params under SigV4.
 *
 * NOTE: the honest truth this code does NOT pretend to solve — audio a browser can play can
 * always be captured (the bytes must reach the client; the AnalyserNode visualizers
 * literally require raw PCM client-side). The goal is friction + revocability, not DRM.
 */

/** Built-in LUFS-family allow-list, so the gate is secure-by-default even if the env var is
 *  unset. `EMBED_ALLOWED_HOSTS` (wrangler.toml [vars]) extends/overrides this. */
export const DEFAULT_EMBED_HOSTS = [
  'catalog.lufs.audio',
  'lufs.audio',
  'www.lufs.audio',
  'danialrami.com',
  'www.danialrami.com',
  'resume.danialrami.com',
  'stream.lufsaud.io',
  'localhost',
  '127.0.0.1',
];

export function parseHostList(csv: string | undefined | null): string[] {
  return String(csv ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Lowercased hostname from an Origin or Referer header value, or null if unusable. */
export function hostFromHeader(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v || v === 'null') return null;
  try {
    return new URL(v).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface GateInput {
  /** Sec-Fetch-Site: same-origin | same-site | cross-site | none */
  secFetchSite?: string | null;
  origin?: string | null;
  referer?: string | null;
  /** Allow-listed hostnames. If empty, DEFAULT_EMBED_HOSTS is used. */
  allowHosts: string[];
}

export interface GateResult {
  allowed: boolean;
  /** Short machine-readable reason, logged for observability. */
  reason: string;
}

/**
 * Decide whether a public `/api/stream` request may proceed.
 * Order: same-site browsing context → allow-listed embedding host → otherwise deny.
 */
export function isEmbedAllowed(input: GateInput): GateResult {
  const sfs = String(input.secFetchSite ?? '').trim().toLowerCase();
  const allow = input.allowHosts.length ? input.allowHosts : DEFAULT_EMBED_HOSTS;

  // The catalog's own pages / iframe (same browsing context as the Worker's domain).
  if (sfs === 'same-origin' || sfs === 'same-site') {
    return { allowed: true, reason: 'same-site' };
  }

  // Prefer Origin (sent on CORS media — `crossorigin="anonymous"`, required for AnalyserNode —
  // and on fetch). Fall back to Referer (sent on a plain `<audio src>` subresource under the
  // default strict-origin-when-cross-origin policy).
  const host = hostFromHeader(input.origin) ?? hostFromHeader(input.referer);
  if (host && allow.includes(host)) {
    return { allowed: true, reason: `allow-host:${host}` };
  }

  // Direct address-bar navigation / bookmark / pasted link: no initiator. THE download vector.
  if (sfs === 'none' || (!host && !sfs)) {
    return { allowed: false, reason: 'deny-direct-navigation' };
  }

  return { allowed: false, reason: host ? `deny-foreign-host:${host}` : 'deny-no-origin' };
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

/** Best-effort audio Content-Type from a key/filename extension; defaults to audio/mpeg. */
export function contentTypeForKey(key: string): string {
  const ext = (String(key).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return CONTENT_TYPES[ext] || 'audio/mpeg';
}

/**
 * Query params folded into the presigned R2 GET (then signed via `signQuery`), in addition
 * to aws4fetch's own `X-Amz-*` params. `response-content-disposition=inline` makes the
 * browser play instead of download; `response-content-type` pins the media type.
 */
export function presignParams(ttl: number, contentType: string): URLSearchParams {
  const q = new URLSearchParams();
  q.set('response-content-disposition', 'inline');
  q.set('response-content-type', contentType);
  q.set('X-Amz-Expires', String(ttl));
  return q;
}
