#!/usr/bin/env node
/**
 * catalog-ingest.mjs — unified LUFS Audio catalog ingest.
 *
 * Canonical source shape (one album per top-level dir under CATALOG_SOURCE_PATH):
 *
 *   {album}/
 *     {track-name}.wav                 source audio (input; ignored here)
 *     {track-name}_astro-catalog/      lufs-workchain output — the unit we read
 *         context.json
 *         {track-name}_normalized.wav
 *         {track-name}_report.html
 *         artwork/  canvas/  catalog/catalog_info.txt  logs/
 *     {another-track}.wav
 *     {another-track}_astro-catalog/
 *
 * An album may hold any number of `*_astro-catalog/` dirs (a single like 3434 has
 * one). Track identity = the dir name minus `_astro-catalog`, reconciled with
 * context.json `input_name`. Track order = alphabetical by dir name (prefix a
 * number like `01_` for explicit order). Albums with no `*_astro-catalog/` dir are
 * skipped (they still need to go through the workchain).
 *
 * Metadata comes from context.json (output paths via path_template),
 * catalog/catalog_info.txt (catalog # + SHA256), logs/normalization.json (loudness).
 * Audio is transcoded WAV->MP3 (default 320k) with duration via ffprobe; the report
 * HTML is sanitized (no WAV audio / download links / canvas GIF).
 *
 * Storage:
 *   STORAGE_MODE=local (default) -> MP3 + report + covers written into public/.
 *   STORAGE_MODE=remote          -> MP3 uploaded to the PRIVATE R2 bucket
 *                                   (releases/…, signed at play time); report +
 *                                   covers still committed to public/. See doc 09.
 *
 * Env: CATALOG_SOURCE_PATH, CATALOG_OUTPUT_ROOT, MP3_BITRATE (320k), STORAGE_MODE,
 *      R2_* (remote), CATALOG_ONLY (process one album, for testing).
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// node-html-parser is a repo dependency; fall back to regex if unavailable.
let parseHTML = null;
try { ({ parse: parseHTML } = await import('node-html-parser')); } catch { /* regex fallback */ }

const __dirname = dirname(fileURLToPath(import.meta.url));

const SRC = process.env.CATALOG_SOURCE_PATH || '/Volumes/project/continuo/catalogs';
const OUTPUT_ROOT = process.env.CATALOG_OUTPUT_ROOT || join(__dirname, '..', '..', '..');
const PUBLIC_DIR = join(OUTPUT_ROOT, 'public');
const CONTENT_DIR = join(OUTPUT_ROOT, 'src', 'content', 'releases');
const MP3_BITRATE = process.env.MP3_BITRATE || '320k';
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';
const ONLY = process.env.CATALOG_ONLY || '';
const REMOTE = STORAGE_MODE !== 'local';

// Lazy-load the R2 uploader only in remote mode (keeps local ingest dependency-free).
let uploadObject = null;
if (REMOTE) {
  try { ({ uploadObject } = await import('./uploadR2.mjs')); }
  catch (e) { console.warn('  ⚠ could not load uploadR2.mjs:', e.message); }
}

// ---------- small utils ----------
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ⚠', ...a);
const ensureDir = (d) => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const isIgnored = (n) => n === '.DS_Store' || n === '__MACOSX' || n.startsWith('._') || n.startsWith('.');
const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const listDirs = (p) => existsSync(p)
  ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !isIgnored(d.name))
  : [];

function copy(src, dest) {
  if (!existsSync(src)) { warn(`missing source: ${src}`); return false; }
  if (statSync(src).isDirectory()) return false;
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  return true;
}
function copyTree(srcDir, destDir, { skipWav = true, skipGif = false } = {}) {
  if (!existsSync(srcDir)) return;
  for (const name of readdirSync(srcDir)) {
    if (isIgnored(name)) continue;
    const s = join(srcDir, name);
    const d = join(destDir, name);
    if (statSync(s).isDirectory()) copyTree(s, d, { skipWav, skipGif });
    else if (skipWav && /\.wav$/i.test(name)) continue;
    else if (skipGif && /\.gif$/i.test(name)) continue; // 45MB Spotify-canvas GIF — never ship
    else copy(s, d);
  }
}

// ---------- media ----------
function ffprobeDuration(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return Math.round(parseFloat(out.trim()) || 0);
  } catch (e) { warn(`ffprobe failed (${basename(file)}): ${e.message}`); return 0; }
}
function transcodeMp3(wav, mp3) {
  ensureDir(dirname(mp3));
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
    '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-joint_stereo', '1', '-map_metadata', '-1', mp3,
  ], { stdio: 'inherit' });
}

// ---------- report sanitize ----------
function sanitizeReport(html) {
  if (parseHTML) {
    const root = parseHTML(html);
    root.querySelectorAll('audio, source').forEach((el) => el.remove());
    root.querySelectorAll('img').forEach((el) => {
      if ((el.getAttribute('src') || '').toLowerCase().endsWith('.gif')) el.remove(); // canvas GIF not shipped
    });
    root.querySelectorAll('a, button').forEach((el) => {
      const href = (el.getAttribute && (el.getAttribute('href') || '')).toLowerCase();
      const isDownload = (el.getAttribute && el.getAttribute('download') !== null)
        || href.endsWith('.wav') || href.endsWith('.mp3')
        || (el.text || '').toLowerCase().includes('download');
      if (isDownload) el.remove();
    });
    return root.toString();
  }
  return html
    .replace(/<audio[\s\S]*?<\/audio>/gi, '')
    .replace(/<source\b[^>]*>/gi, '')
    .replace(/<img\b[^>]*src="[^"]*\.gif"[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="[^"]*\.(wav|mp3)"[^>]*>[\s\S]*?<\/a>/gi, '');
}

// ---------- astro-catalog discovery + metadata ----------
// Find every `*_astro-catalog/` (or bare `astro-catalog/`) dir with a context.json.
function findAstroTracks(albumPath) {
  return listDirs(albumPath)
    .filter((d) => /_astro-catalog$/.test(d.name) || d.name === 'astro-catalog')
    .map((d) => ({ acDir: join(albumPath, d.name), dirName: d.name }))
    .filter((t) => existsSync(join(t.acDir, 'context.json')))
    .sort((a, b) => a.dirName.localeCompare(b.dirName, undefined, { numeric: true, sensitivity: 'base' }));
}

function parseAstroCatalog(acDir) {
  const ctx = JSON.parse(readFileSync(join(acDir, 'context.json'), 'utf8'));
  const name = ctx.input_name || basename(acDir).replace(/_astro-catalog$/, '');
  const ext = ctx.input_ext || 'wav';
  const tmpl = (t) => t.replace('{input_name}', name).replace('{input_ext}', ext);
  const steps = ctx.steps || {};
  // Resolve outputs from path_template relative to acDir (NOT the absolute paths
  // baked into context.json, which point at the machine that produced them).
  const out = (step, key = 'primary_output') => {
    const o = steps[step]?.outputs?.[key];
    return o?.path_template ? join(acDir, tmpl(o.path_template)) : null;
  };

  const normalizedWav = out('normalization') || join(acDir, `${name}_normalized.${ext}`);
  const reportHtml = out('reporting') || join(acDir, `${name}_report.html`);
  const artworkMain = out('artwork_01') || join(acDir, 'artwork', `${name}_artwork.png`);

  let catalogNumber = '';
  let sha256 = '';
  const catInfo = join(acDir, 'catalog', 'catalog_info.txt');
  if (existsSync(catInfo)) {
    const t = readFileSync(catInfo, 'utf8');
    catalogNumber = t.match(/Catalog Number:\s*(lufs-[a-f0-9]+)/i)?.[1] || '';
    sha256 = t.match(/Full SHA256 Hash:\s*([a-f0-9]{64})/i)?.[1] || '';
  }

  let loudness = {};
  const nj = join(acDir, 'logs', 'normalization.json');
  if (existsSync(nj)) {
    try {
      const j = JSON.parse(readFileSync(nj, 'utf8'));
      const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
      loudness = {
        targetLufs: num(j.target_lufs), finalLufs: num(j.final_lufs), truePeak: num(j.true_peak),
        lra: num(j.lra), sampleRate: num(j.sample_rate), channels: num(j.channels),
      };
    } catch (e) { warn(`bad normalization.json: ${e.message}`); }
  }

  return {
    name, ext, acDir, normalizedWav, reportHtml, artworkMain,
    catalogNumber, sha256, status: ctx.status,
    processedDate: ctx.end_time || ctx.start_time || new Date().toISOString(),
    saturation: ctx.globals?.saturation,
    loudness,
  };
}

// ---------- per-track ----------
async function processAstroTrack(collectionId, trackNumber, acDir) {
  const m = parseAstroCatalog(acDir);
  // Skip incomplete/failed workchain runs so a half-written dir never becomes a broken entry.
  if (m.status && m.status !== 'completed') {
    warn(`skip "${m.name}" — workchain status="${m.status}" (incomplete/failed): ${acDir}`);
    return null;
  }
  if (!existsSync(m.normalizedWav)) {
    warn(`skip "${m.name}" — normalized WAV missing (failed run?): ${m.normalizedWav}`);
    return null;
  }
  const n = String(trackNumber);
  const base = slugify(m.name) || `track-${n}`; // path/URL-safe (track names may have spaces)
  log(`    track ${n}: "${m.name}"  ${m.catalogNumber || '(no catalog#)'}`);

  const reportDir = join(PUBLIC_DIR, 'reports', collectionId, n);
  const coverDir = join(PUBLIC_DIR, 'covers', collectionId, n);

  // 1) transcode normalized WAV -> MP3 + duration.
  //    local  -> public/audio/…  |  remote -> temp file -> R2 releases/… (then audioPath = key)
  let duration = 0;
  let audioPath = '';
  if (!existsSync(m.normalizedWav)) {
    warn(`normalized WAV not found: ${m.normalizedWav}`);
  } else if (REMOTE) {
    const tmpMp3 = join(tmpdir(), `lufs-${slugify(collectionId)}-${n}-${base}.mp3`);
    transcodeMp3(m.normalizedWav, tmpMp3);
    duration = ffprobeDuration(tmpMp3);
    const key = `releases/${collectionId}/${n}/${base}.mp3`;
    if (uploadObject) await uploadObject(tmpMp3, key, 'audio/mpeg');
    else warn('remote mode but uploader unavailable; audio not uploaded');
    rmSync(tmpMp3, { force: true });
    audioPath = key; // the player exchanges this key for a signed URL via the Worker
  } else {
    const audioDest = join(PUBLIC_DIR, 'audio', collectionId, n, `${base}.mp3`);
    transcodeMp3(m.normalizedWav, audioDest);
    duration = ffprobeDuration(audioDest);
    audioPath = `/audio/${collectionId}/${n}/${base}.mp3`;
  }

  // 2) sanitized report + its relative assets (no WAV, no canvas GIF) so links resolve
  if (existsSync(m.reportHtml)) {
    ensureDir(reportDir);
    writeFileSync(join(reportDir, 'final_report.html'), sanitizeReport(readFileSync(m.reportHtml, 'utf8')));
    for (const sub of ['artwork', 'canvas', 'logs']) copyTree(join(m.acDir, sub), join(reportDir, sub), { skipWav: true, skipGif: true });
  } else { warn(`report not found: ${m.reportHtml}`); }

  // 3) covers for the site UI
  copy(m.artworkMain, join(coverDir, 'artwork.png'));
  const comp = join(m.acDir, 'artwork', 'components');
  for (const f of ['identicon.png', 'spectrogram.png', 'rectangle_spectrogram.png']) copy(join(comp, f), join(coverDir, f));
  copy(join(m.acDir, 'canvas', `${m.name}_canvas_static.png`), join(coverDir, 'canvas_static.png'));

  return {
    trackNumber,
    displayTitle: m.name,
    filename: base,
    catalogNumber: m.catalogNumber,
    sha256: m.sha256,
    processedDate: m.processedDate,
    saturation: m.saturation,
    audioPath,
    finalReport: `/reports/${collectionId}/${n}/final_report.html`,
    duration,
    loudness: m.loudness,
    artwork: {
      main: `/covers/${collectionId}/${n}/artwork.png`,
      identicon: `/covers/${collectionId}/${n}/identicon.png`,
      spectrogram: `/covers/${collectionId}/${n}/spectrogram.png`,
      canvasStatic: `/covers/${collectionId}/${n}/canvas_static.png`,
    },
  };
}

// ---------- markdown (read human fields, then write) ----------
function readHumanFields(slug) {
  const p = join(CONTENT_DIR, `${slug}.md`);
  if (!existsSync(p)) return {};
  const fm = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const scalar = (k) => fm.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1];
  const nested = (k) => fm.match(new RegExp(`^\\s+${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] || '';
  const tagsBlock = fm.match(/^tags:\s*\n([\s\S]*?)(?=^\S)/m)?.[1] || '';
  const tags = [...tagsBlock.matchAll(/^\s*-\s*"?([^"\n]+?)"?\s*$/gm)].map((x) => x[1].trim());
  return {
    title: scalar('title'),
    project: scalar('project'),
    releaseDate: scalar('releaseDate'),
    status: scalar('status'),
    isrc: scalar('isrc'),
    tags,
    streamingLinks: {
      spotify: nested('spotify'), appleMusic: nested('appleMusic'),
      bandcamp: nested('bandcamp'), soundcloud: nested('soundcloud'),
    },
  };
}

function writeReleaseMarkdown(slug, data) {
  const q = (v) => JSON.stringify(v ?? '');
  const trackYaml = data.tracks.map((t) => {
    const L = [
      `  - trackNumber: ${t.trackNumber}`,
      `    displayTitle: ${q(t.displayTitle)}`,
      `    filename: ${q(t.filename)}`,
      `    catalogNumber: ${q(t.catalogNumber)}`,
      `    sha256: ${q(t.sha256)}`,
      `    processedDate: ${q(t.processedDate)}`,
    ];
    if (t.saturation !== undefined) L.push(`    saturation: ${t.saturation}`);
    L.push(`    audioPath: ${q(t.audioPath)}`);
    if (t.renderStatsPath) L.push(`    renderStatsPath: ${q(t.renderStatsPath)}`);
    L.push(`    finalReport: ${q(t.finalReport)}`);
    L.push(`    duration: ${t.duration ?? 0}`);
    const loud = t.loudness && Object.entries(t.loudness).filter(([, v]) => v !== undefined);
    if (loud && loud.length) { L.push('    loudness:'); for (const [k, v] of loud) L.push(`      ${k}: ${v}`); }
    L.push('    artwork:');
    for (const [k, v] of Object.entries(t.artwork)) if (v) L.push(`      ${k}: ${q(v)}`);
    return L.join('\n');
  }).join('\n');

  const sl = data.streamingLinks || {};
  const body = [
    '---',
    `title: ${q(data.title)}`,
    `collectionId: ${q(data.collectionId)}`,
    `project: ${q(data.project)}`,
    `artist: ${q(data.artist || 'Daniel Ramirez')}`,
    `releaseDate: ${data.releaseDate}`,
    `status: ${q(data.status)}`,
    `coverArt: ${q(data.coverArt)}`,
    ...(data.isrc ? [`isrc: ${q(data.isrc)}`] : []),
    'streamingLinks:',
    `  spotify: ${q(sl.spotify)}`,
    `  appleMusic: ${q(sl.appleMusic)}`,
    `  bandcamp: ${q(sl.bandcamp)}`,
    `  soundcloud: ${q(sl.soundcloud)}`,
    'tags:',
    ...((data.tags || []).map((t) => `  - ${q(t)}`)),
    'tracks:',
    trackYaml,
    '---',
    '',
  ].join('\n');

  ensureDir(CONTENT_DIR);
  writeFileSync(join(CONTENT_DIR, `${slug}.md`), body);
}

// ---------- orchestrator ----------
function deriveIds(dirName) {
  // The folder name IS the album name verbatim (e.g. "a98ff_praise-legend-road" is the
  // real album name, hex prefix included) — do not strip anything.
  return { collectionId: dirName, slug: slugify(dirName) };
}

async function main() {
  log('=== LUFS catalog ingest ===');
  log(`source : ${SRC}`);
  log(`output : ${OUTPUT_ROOT}  (mode=${STORAGE_MODE}, mp3=${MP3_BITRATE}, html-parser=${parseHTML ? 'node-html-parser' : 'regex-fallback'})`);
  if (!existsSync(SRC)) { console.error(`CATALOG_SOURCE_PATH not found: ${SRC}`); process.exit(1); }
  if (REMOTE) log(`  remote: audio -> R2 bucket "${process.env.R2_BUCKET_NAME || '(R2_BUCKET_NAME unset)'}"; reports + covers committed to public/.`);

  let albums = listDirs(SRC).map((d) => d.name).sort();
  if (ONLY) albums = albums.filter((n) => n === ONLY);

  const processed = [];
  const skipped = [];

  for (const dirName of albums) {
    const albumPath = join(SRC, dirName);
    const { collectionId, slug } = deriveIds(dirName);
    const found = findAstroTracks(albumPath);
    log(`\nalbum: ${dirName}  (${found.length} astro-catalog track(s))`);

    if (!found.length) {
      warn(`no *_astro-catalog/ output in ${dirName} — skipping (run it through the lufs-workchain first).`);
      skipped.push(`${dirName} (unprocessed)`);
      continue;
    }

    const tracks = [];
    for (const t of found) {
      const track = await processAstroTrack(collectionId, tracks.length + 1, t.acDir);
      if (track) tracks.push(track); // null = incomplete/failed run, skipped
    }
    if (!tracks.length) {
      warn(`no completed astro-catalog tracks in ${dirName} — skipping.`);
      skipped.push(`${dirName} (no completed tracks)`);
      continue;
    }

    // collection cover = first track's artwork
    copy(join(PUBLIC_DIR, 'covers', collectionId, '1', 'artwork.png'),
         join(PUBLIC_DIR, 'covers', collectionId, 'cover.png'));

    const human = readHumanFields(slug);
    const single = tracks.length === 1;
    writeReleaseMarkdown(slug, {
      title: human.title || (single ? tracks[0].displayTitle : dirName),
      collectionId,
      project: human.project || (single ? 'Singles' : (human.title || dirName)),
      artist: 'Daniel Ramirez',
      releaseDate: human.releaseDate || (tracks[0].processedDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      status: human.status || 'draft',
      coverArt: `/covers/${collectionId}/cover.png`,
      isrc: human.isrc || '',
      streamingLinks: human.streamingLinks,
      tags: human.tags || [],
      tracks,
    });
    log(`  ✓ wrote src/content/releases/${slug}.md  (${tracks.length} track(s), status=${human.status || 'draft'})`);
    processed.push(`${slug} <- ${dirName} (${tracks.length} track(s))`);
  }

  log('\n=== summary ===');
  log(`processed: ${processed.length ? processed.join('; ') : '(none)'}`);
  log(`skipped  : ${skipped.length ? skipped.join('; ') : '(none)'}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
