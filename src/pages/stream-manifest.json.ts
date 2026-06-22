/**
 * /stream-manifest.json — build-time manifest that maps public stream ids to audio sources.
 *
 * Emitted as a static file by `astro build` (output: 'static'), so it costs nothing at
 * runtime and is regenerated on every catalog deploy — it can never drift from content.
 * The signing Worker fetches + edge-caches this to resolve /api/stream/<id> (see
 * worker/src/manifest.ts + resolve.ts).
 *
 * Identifiers: `id` is the catalogNumber (canonical, content-addressed, unique). `slug` is
 * the human filename (NOT unique across releases — the Worker disambiguates). Only RELEASED
 * tracks with a real catalogNumber + playable source are exposed via the public API.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

interface ManifestTrack {
  id: string;
  slug: string;
  collection: string;
  releaseSlug: string;
  key?: string;
  url?: string;
  title: string;
  cover?: string;
  duration?: number;
}

function isDirectUrl(ref: string): boolean {
  return ref.startsWith('/') || /^https?:\/\//i.test(ref);
}

export const GET: APIRoute = async () => {
  const releases = await getCollection('releases');
  const tracks: ManifestTrack[] = [];

  for (const release of releases) {
    const d = release.data;
    if (d.status !== 'released') continue; // never expose unreleased/draft audio publicly
    for (const t of d.tracks ?? []) {
      const ref = t.audioPath?.trim();
      const id = t.catalogNumber?.trim();
      if (!ref || !id) continue; // need a stable id + a source

      const entry: ManifestTrack = {
        id,
        slug: t.filename,
        collection: d.collectionId,
        releaseSlug: release.slug,
        title: t.displayTitle,
        cover: d.coverArt || undefined,
        duration: t.duration || undefined,
      };

      if (ref.startsWith('releases/')) entry.key = ref;      // private R2 key → Worker signs
      else if (isDirectUrl(ref)) entry.url = ref;            // already-public URL → pass through
      else continue;                                         // unknown shape → skip, don't guess

      tracks.push(entry);
    }
  }

  const body = JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    count: tracks.length,
    tracks,
  });

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
