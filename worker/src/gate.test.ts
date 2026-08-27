import { describe, it, expect } from 'vitest';
import {
  isEmbedAllowed,
  parseHostList,
  hostFromHeader,
  contentTypeForKey,
  presignParams,
  DEFAULT_EMBED_HOSTS,
} from './gate';

const ALLOW = DEFAULT_EMBED_HOSTS;

describe('parseHostList', () => {
  it('splits, trims, lowercases, drops empties', () => {
    expect(parseHostList(' A.com , b.COM ,, ')).toEqual(['a.com', 'b.com']);
    expect(parseHostList(undefined)).toEqual([]);
    expect(parseHostList('')).toEqual([]);
  });
});

describe('hostFromHeader', () => {
  it('extracts a lowercased hostname from a URL header', () => {
    expect(hostFromHeader('https://Resume.danialrami.com/cv')).toBe('resume.danialrami.com');
    expect(hostFromHeader('https://lufs.audio')).toBe('lufs.audio');
  });
  it('returns null for opaque/garbage/empty values', () => {
    expect(hostFromHeader('null')).toBeNull();
    expect(hostFromHeader('')).toBeNull();
    expect(hostFromHeader('not a url')).toBeNull();
    expect(hostFromHeader(undefined)).toBeNull();
  });
});

describe('isEmbedAllowed — the access truth table', () => {
  it('allows the catalog itself (same-origin / same-site)', () => {
    expect(isEmbedAllowed({ secFetchSite: 'same-origin', allowHosts: ALLOW }).allowed).toBe(true);
    expect(isEmbedAllowed({ secFetchSite: 'same-site', allowHosts: ALLOW }).allowed).toBe(true);
  });

  it('allows a cross-site embed from an allow-listed host via Origin (CORS / AnalyserNode)', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', origin: 'https://lufs.audio', allowHosts: ALLOW });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('allow-host:lufs.audio');
  });

  it('allows a cross-site embed from an allow-listed host via Referer only (plain <audio src>)', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', referer: 'https://resume.danialrami.com/', allowHosts: ALLOW });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('allow-host:resume.danialrami.com');
  });

  it('DENIES direct address-bar navigation — the exact download hole that was reported', () => {
    // Pasting the URL in a browser: Sec-Fetch-Site: none, no Origin, no Referer.
    const r = isEmbedAllowed({ secFetchSite: 'none', allowHosts: ALLOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-direct-navigation');
  });

  it('DENIES a foreign-site hotlink', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', referer: 'https://evil.example.com/steal', allowHosts: ALLOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-foreign-host:evil.example.com');
  });

  it('DENIES a cross-site request that stripped its initiator (no host, has Sec-Fetch-Site)', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', allowHosts: ALLOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-no-origin');
  });

  it('treats a missing-everything request (legacy/no Sec-Fetch headers) as direct navigation', () => {
    const r = isEmbedAllowed({ allowHosts: ALLOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-direct-navigation');
  });

  it('falls back to the built-in LUFS allow-list when no env hosts are configured', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', origin: 'https://catalog.lufs.audio', allowHosts: [] });
    expect(r.allowed).toBe(true);
  });

  it('honors an extra env-configured host', () => {
    const r = isEmbedAllowed({ secFetchSite: 'cross-site', origin: 'https://example.org', allowHosts: ['example.org'] });
    expect(r.allowed).toBe(true);
  });
});

describe('contentTypeForKey', () => {
  it('maps known audio extensions and defaults to audio/mpeg', () => {
    expect(contentTypeForKey('releases/x/lufs-1/track.mp3')).toBe('audio/mpeg');
    expect(contentTypeForKey('a/b/c.wav')).toBe('audio/wav');
    expect(contentTypeForKey('a/b/c.flac')).toBe('audio/flac');
    expect(contentTypeForKey('a/b/c.m4a')).toBe('audio/mp4');
    expect(contentTypeForKey('a/b/c.opus')).toBe('audio/ogg');
    expect(contentTypeForKey('a/b/c')).toBe('audio/mpeg');
    expect(contentTypeForKey('a/b/c.weird')).toBe('audio/mpeg');
  });
});

describe('presignParams', () => {
  it('forces inline disposition + content-type + the expiry, so the URL plays not downloads', () => {
    const q = presignParams(1200, 'audio/mpeg');
    expect(q.get('response-content-disposition')).toBe('inline');
    expect(q.get('response-content-type')).toBe('audio/mpeg');
    expect(q.get('X-Amz-Expires')).toBe('1200');
  });
});
