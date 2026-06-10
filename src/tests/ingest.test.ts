import { describe, it, expect } from 'vitest';
// Pure helpers exported from the ingest. Importing is safe: the module only runs
// main() when invoked directly (node catalog-ingest.mjs), not when imported.
import { slugify, deriveIds, sanitizeReport } from '../scripts/ingest/catalog-ingest.mjs';

describe('catalog-ingest: slugify', () => {
  it('lowercases and hyphenates spaces and punctuation', () => {
    expect(slugify('Footlights - _Collapse_ Full')).toBe('footlights-collapse-full');
    expect(slugify("01 Don't Let Me Fall Asleep")).toBe('01-don-t-let-me-fall-asleep');
    expect(slugify('Prelude No. 1 in Bb Major')).toBe('prelude-no-1-in-bb-major');
    expect(slugify('wheels (theme in variations)')).toBe('wheels-theme-in-variations');
  });
  it('trims leading/trailing separators', () => {
    expect(slugify('  Score 1- All.L  ')).toBe('score-1-all-l');
  });
});

describe('catalog-ingest: deriveIds', () => {
  it('keeps the album folder name verbatim as collectionId, slug for the filename', () => {
    expect(deriveIds('a98ff_praise-legend-road')).toEqual({
      collectionId: 'a98ff_praise-legend-road',
      slug: 'a98ff-praise-legend-road',
    });
    expect(deriveIds('10-00.0006-37.182_final')).toEqual({
      collectionId: '10-00.0006-37.182_final',
      slug: '10-00-0006-37-182-final',
    });
  });
});

describe('catalog-ingest: sanitizeReport', () => {
  it('strips audio, download links and the canvas gif but keeps body content', () => {
    const html =
      '<div><audio controls><source src="x.wav"></audio>' +
      '<a href="x.wav" download>Download WAV</a>' +
      '<img src="canvas/x_canvas.gif"><p>keep this</p></div>';
    const out = sanitizeReport(html);
    expect(out).not.toMatch(/<audio/i);
    expect(out).not.toMatch(/\.gif/i);
    expect(out).not.toMatch(/download/i);
    expect(out).toContain('keep this');
  });
});
