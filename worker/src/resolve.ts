/**
 * resolve.ts — pure, dependency-free resolution of a public stream id to a manifest track.
 *
 * The catalog's canonical track id is `catalogNumber` (e.g. "lufs-2190d993") — the first 8
 * hex of the source audio's SHA-256, content-addressed and collision-free. The per-track
 * `filename` slug is human-readable but NOT unique across releases, so a bare slug can be
 * ambiguous. Resolution order, most-specific first:
 *
 *   1. exact catalogNumber          → "lufs-2190d993"
 *   2. "{collection}/{slug}"         → "footlights/footlight-when-i-fall"   (also unique)
 *   3. bare "{slug}"                 → "footlight-when-i-fall"  ONLY if unambiguous
 *
 * A bare slug that matches >1 track resolves to `ambiguous` (with candidates) rather than
 * guessing — honest failure over a silent wrong-track bug. This module is kept pure so it
 * can be unit-tested without a Workers runtime (see resolve.test.ts).
 */

export interface ManifestTrack {
  /** catalogNumber, canonical + collision-free, e.g. "lufs-2190d993". */
  id: string;
  /** filename slug, human-readable, NOT unique across releases. */
  slug: string;
  /** release collectionId, e.g. "footlights". */
  collection: string;
  /** the release slug this track belongs to (for release-URL oEmbed lookups). */
  releaseSlug?: string;
  /** private R2 object key ("releases/…/file.mp3") — needs the signing Worker. */
  key?: string;
  /** already-public direct URL — served as-is (no signing). Mutually exclusive with key. */
  url?: string;
  title: string;
  cover?: string;
  duration?: number;
}

export interface StreamManifest {
  version: number;
  generatedAt?: string;
  tracks: ManifestTrack[];
}

export type ResolveResult =
  | { ok: true; track: ManifestTrack }
  | { ok: false; error: 'not_found' | 'ambiguous'; candidates?: ManifestTrack[] };

/** Normalize a raw path id: decode, trim, strip a trailing ".mp3", collapse a leading slash. */
export function normalizeId(rawId: string): string {
  let id = String(rawId ?? '');
  try { id = decodeURIComponent(id); } catch { /* keep raw if not decodable */ }
  return id.trim().replace(/^\/+/, '').replace(/\.mp3$/i, '');
}

export function resolveStreamId(manifest: StreamManifest | null | undefined, rawId: string): ResolveResult {
  const tracks = manifest?.tracks ?? [];
  const id = normalizeId(rawId);
  if (!id) return { ok: false, error: 'not_found' };
  const lower = id.toLowerCase();

  // 1) exact catalogNumber
  const byId = tracks.find((t) => t.id?.toLowerCase() === lower);
  if (byId) return { ok: true, track: byId };

  // 2) "{collection}/{slug}"
  if (id.includes('/')) {
    const slashAt = id.indexOf('/');
    const coll = id.slice(0, slashAt).toLowerCase();
    const slug = id.slice(slashAt + 1).toLowerCase();
    const byPath = tracks.find(
      (t) => t.collection?.toLowerCase() === coll && t.slug?.toLowerCase() === slug,
    );
    if (byPath) return { ok: true, track: byPath };
    return { ok: false, error: 'not_found' };
  }

  // 3) bare "{slug}" — only if unambiguous
  const bySlug = tracks.filter((t) => t.slug?.toLowerCase() === lower);
  if (bySlug.length === 1) return { ok: true, track: bySlug[0] };
  if (bySlug.length > 1) return { ok: false, error: 'ambiguous', candidates: bySlug };
  return { ok: false, error: 'not_found' };
}

/** First track (manifest order) of a given release slug — for release-URL oEmbed. */
export function firstTrackOfRelease(
  manifest: StreamManifest | null | undefined,
  releaseSlug: string,
): ManifestTrack | null {
  const slug = normalizeId(releaseSlug).toLowerCase();
  if (!slug) return null;
  return (manifest?.tracks ?? []).find((t) => t.releaseSlug?.toLowerCase() === slug) ?? null;
}
