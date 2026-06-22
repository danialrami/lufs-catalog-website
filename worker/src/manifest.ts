/**
 * manifest.ts — fetch the catalog's build-time stream manifest, edge-cached.
 *
 * The manifest is a static file emitted by the Astro build at
 * `https://catalog.lufs.audio/stream-manifest.json` (see src/pages/stream-manifest.json.ts).
 * It is regenerated on every catalog deploy, so the Worker just needs a short edge cache —
 * Cloudflare's `cf.cacheTtl` keeps the Worker stateless and decoupled from catalog deploys.
 */
import type { StreamManifest } from './resolve';

export async function loadManifest(url: string, ttlSeconds: number): Promise<StreamManifest> {
  const res = await fetch(url, {
    // `cf` is a Workers-specific fetch option; cache the manifest at the edge.
    cf: { cacheTtl: Math.max(0, ttlSeconds | 0), cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const data = (await res.json()) as StreamManifest;
  if (!data || !Array.isArray(data.tracks)) throw new Error('manifest malformed: no tracks[]');
  return data;
}
