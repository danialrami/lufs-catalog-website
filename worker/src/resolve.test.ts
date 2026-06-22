import { describe, it, expect } from 'vitest';
import { resolveStreamId, normalizeId, firstTrackOfRelease, type StreamManifest } from './resolve';

const manifest: StreamManifest = {
  version: 1,
  tracks: [
    { id: 'lufs-2190d993', slug: 'footlight-when-i-fall', collection: 'footlights', releaseSlug: 'footlights', key: 'releases/footlights/lufs-2190d993/footlight-when-i-fall.mp3', title: 'Footlight When I Fall' },
    { id: 'lufs-aaaa1111', slug: 'intro', collection: 'footlights', releaseSlug: 'footlights', key: 'releases/footlights/lufs-aaaa1111/intro.mp3', title: 'Intro' },
    // Deliberate collision: a second different release also has a track slugged "intro".
    { id: 'lufs-bbbb2222', slug: 'intro', collection: 'nightshade', releaseSlug: 'nightshade', key: 'releases/nightshade/lufs-bbbb2222/intro.mp3', title: 'Intro (Nightshade)' },
    { id: 'lufs-cccc3333', slug: 'public-demo', collection: 'demos', releaseSlug: 'demos', url: 'https://cdn.lufsaud.io/public/demo.mp3', title: 'Public Demo' },
  ],
};

describe('normalizeId', () => {
  it('decodes, trims, strips leading slash and .mp3', () => {
    expect(normalizeId('  /lufs-2190d993.mp3 ')).toBe('lufs-2190d993');
    expect(normalizeId('footlights%2Fintro')).toBe('footlights/intro');
  });
});

describe('resolveStreamId', () => {
  it('resolves the canonical catalogNumber (case-insensitive)', () => {
    const r = resolveStreamId(manifest, 'LUFS-2190D993');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.track.title).toBe('Footlight When I Fall');
  });

  it('resolves {collection}/{slug} even when the bare slug is ambiguous', () => {
    const r = resolveStreamId(manifest, 'nightshade/intro');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.track.id).toBe('lufs-bbbb2222');
  });

  it('resolves an unambiguous bare slug', () => {
    const r = resolveStreamId(manifest, 'footlight-when-i-fall');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.track.id).toBe('lufs-2190d993');
  });

  it('FAILS LOUDLY on an ambiguous bare slug rather than guessing', () => {
    const r = resolveStreamId(manifest, 'intro');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('ambiguous');
      expect(r.candidates?.map((c) => c.id).sort()).toEqual(['lufs-aaaa1111', 'lufs-bbbb2222']);
    }
  });

  it('returns not_found for unknown ids and empty input', () => {
    expect(resolveStreamId(manifest, 'nope').ok).toBe(false);
    expect(resolveStreamId(manifest, '').ok).toBe(false);
    expect(resolveStreamId(manifest, 'footlights/does-not-exist').ok).toBe(false);
    expect(resolveStreamId(null, 'lufs-2190d993').ok).toBe(false);
  });

  it('strips a trailing .mp3 so /api/stream/{id}.mp3 works as a media src', () => {
    const r = resolveStreamId(manifest, 'lufs-2190d993.mp3');
    expect(r.ok).toBe(true);
  });

  it('carries a direct url track through unchanged (no key)', () => {
    const r = resolveStreamId(manifest, 'lufs-cccc3333');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.track.url).toContain('cdn.lufsaud.io'); expect(r.track.key).toBeUndefined(); }
  });
});

describe('firstTrackOfRelease', () => {
  it('returns the first manifest-ordered track of a release', () => {
    expect(firstTrackOfRelease(manifest, 'footlights')?.id).toBe('lufs-2190d993');
    expect(firstTrackOfRelease(manifest, 'nightshade')?.id).toBe('lufs-bbbb2222');
    expect(firstTrackOfRelease(manifest, 'unknown')).toBeNull();
  });
});
