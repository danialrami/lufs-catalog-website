import { describe, it, expect } from 'vitest';
// Pure helpers exported from the ingest. Importing is safe: the module only runs
// main() when invoked directly (node catalog-ingest.mjs), not when imported.
import { slugify, deriveIds, sanitizeReport, parseAstroCatalog, decideStatus } from '../scripts/ingest/catalog-ingest.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('catalog-ingest: parseAstroCatalog (identity from dir, not clobbered context)', () => {
  it('resolves track + normalized audio from the folder even when context.json input_name is "catalog_info"', () => {
    const base = mkdtempSync(join(tmpdir(), 'ac-'));
    const acDir = join(base, 'My Track_astro-catalog');
    mkdirSync(join(acDir, 'catalog'), { recursive: true });
    mkdirSync(join(acDir, 'artwork'));
    mkdirSync(join(acDir, 'canvas'));
    // real artifacts are named after the track…
    writeFileSync(join(acDir, 'My Track_normalized.wav'), '');
    writeFileSync(join(acDir, 'My Track_original.wav'), '');         // must be ignored
    writeFileSync(join(acDir, 'My Track_report.html'), '<p>r</p>');
    writeFileSync(join(acDir, 'artwork', 'My Track_artwork.png'), '');
    writeFileSync(join(acDir, 'canvas', 'My Track_canvas_static.png'), '');
    const sha = 'a'.repeat(64);
    writeFileSync(join(acDir, 'catalog', 'catalog_info.txt'),
      `Catalog Number: lufs-abcdef12\nFull SHA256 Hash: ${sha}\n`);
    // …but context.json input_name/ext are clobbered to the final catalog step output
    writeFileSync(join(acDir, 'context.json'), JSON.stringify({
      input_name: 'catalog_info', input_ext: 'txt', status: 'completed',
      end_time: '2026-06-10T00:00:00Z', globals: { saturation: 0.5 },
    }));

    const m = parseAstroCatalog(acDir);
    expect(m.name).toBe('My Track');
    expect(m.normalizedWav.endsWith('My Track_normalized.wav')).toBe(true);
    expect(m.reportHtml.endsWith('My Track_report.html')).toBe(true);
    expect(m.artworkMain.endsWith('My Track_artwork.png')).toBe(true);
    expect(m.canvasStatic.endsWith('My Track_canvas_static.png')).toBe(true);
    expect(m.catalogNumber).toBe('lufs-abcdef12');
    expect(m.sha256).toBe(sha);
    expect(m.status).toBe('completed');
  });

  it('discovers a non-wav normalized file (e.g. .mp3) by suffix', () => {
    const base = mkdtempSync(join(tmpdir(), 'ac-'));
    const acDir = join(base, 'Song_astro-catalog');
    mkdirSync(acDir, { recursive: true });
    writeFileSync(join(acDir, 'Song_normalized.mp3'), '');
    writeFileSync(join(acDir, 'context.json'), JSON.stringify({
      input_name: 'catalog_info', input_ext: 'txt', status: 'completed',
    }));
    const m = parseAstroCatalog(acDir);
    expect(m.name).toBe('Song');
    expect(m.ext).toBe('mp3');
    expect(m.normalizedWav.endsWith('Song_normalized.mp3')).toBe(true);
  });
});

describe('catalog-ingest: decideStatus (publish policy)', () => {
  it('remote (prod) defaults to released, but honors an explicit "unreleased" opt-out', () => {
    expect(decideStatus(true, undefined)).toBe('released');     // brand-new release → live
    expect(decideStatus(true, 'draft')).toBe('released');       // prior default draft → promoted
    expect(decideStatus(true, 'released')).toBe('released');
    expect(decideStatus(true, 'unreleased')).toBe('unreleased'); // manual hide is preserved
  });
  it('local preserves human status, defaulting to draft', () => {
    expect(decideStatus(false, undefined)).toBe('draft');
    expect(decideStatus(false, 'released')).toBe('released');
    expect(decideStatus(false, 'unreleased')).toBe('unreleased');
  });
});

describe('catalog-ingest: sanitizeReport', () => {
  it('strips audio, download links and the canvas gif but keeps body content', () => {
    const html =
      '<div><audio controls><source src="x.wav"></audio>' +
      '<video src="canvas/x_canvas.mp4"></video>' +
      '<a href="x.wav" download>Download WAV</a>' +
      '<img src="canvas/x_canvas.gif"><p>keep this</p></div>';
    const out = sanitizeReport(html);
    expect(out).not.toMatch(/<audio/i);
    expect(out).not.toMatch(/<video/i);
    expect(out).not.toMatch(/\.gif/i);
    expect(out).not.toMatch(/download/i);
    expect(out).toContain('keep this');
  });
});
