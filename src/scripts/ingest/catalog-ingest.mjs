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
 *   STORAGE_MODE=remote          -> MP3 -> PRIVATE R2 bucket (releases/…, signed at
 *                                   play time). Covers + the proof-of-work report (and
 *                                   its full-fidelity canvas video/gif/spectrograms) ->
 *                                   PUBLIC R2 bucket (R2_PUBLIC_BUCKET_NAME), served from
 *                                   PUBLIC_R2_BASE_URL (e.g. cdn.lufsaud.io). The local
 *                                   public/ copies are removed after upload so nothing
 *                                   heavy is committed to git or shipped in the Hostinger
 *                                   deploy. If the public bucket isn't configured it falls
 *                                   back to committing covers/reports under public/. Doc 09.
 *
 * Env: CATALOG_SOURCE_PATH, CATALOG_OUTPUT_ROOT, MP3_BITRATE (320k), STORAGE_MODE,
 *      R2_* (private audio), R2_PUBLIC_BUCKET_NAME + PUBLIC_R2_BASE_URL (public covers/
 *      reports), R2_FORCE_UPLOAD (re-upload even when unchanged), CATALOG_ONLY (one album).
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// node-html-parser is a repo dependency; fall back to regex if unavailable.
let parseHTML = null;
try { ({ parse: parseHTML } = await import('node-html-parser')); } catch { /* regex fallback */ }

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-load a .env file when the caller hasn't already provided the environment, so
// `pnpm catalog:ingest` honors .env.production / .env.local (like Astro does for builds)
// and never silently runs in local mode when you meant remote. The wrappers
// (catalog-dev.sh / catalog-deploy.sh) pre-source their env (STORAGE_MODE is set), so
// this is a no-op for them. Parser is shell-free: it ignores comments (incl. inline
// `value  # note`) and strips surrounding quotes, so placeholders like `pub-<hash>` are
// harmless. Only fills vars that aren't already set.
function loadDotenv() {
  if (process.env.STORAGE_MODE) return;
  const root = process.env.CATALOG_OUTPUT_ROOT || join(__dirname, '..', '..', '..');
  for (const name of ['.env.production', '.env.local', '.env']) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).replace(/\s+#.*$/, '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log(`env    : loaded ${name}`);
    break;
  }
}
loadDotenv();

const SRC = process.env.CATALOG_SOURCE_PATH || '/Volumes/project/continuo/catalogs';
const OUTPUT_ROOT = process.env.CATALOG_OUTPUT_ROOT || join(__dirname, '..', '..', '..');
const PUBLIC_DIR = join(OUTPUT_ROOT, 'public');
const CONTENT_DIR = join(OUTPUT_ROOT, 'src', 'content', 'releases');
const MP3_BITRATE = process.env.MP3_BITRATE || '320k';
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';
const ONLY = process.env.CATALOG_ONLY || '';
const REMOTE = STORAGE_MODE !== 'local';

// Public-asset serving (remote only): when BOTH a public bucket and its served base URL
// are set, covers + the proof-of-work report go to the PUBLIC R2 bucket and are served
// from PUBLIC_R2_BASE_URL (e.g. cdn.lufsaud.io) instead of being committed to public/.
// Requires both — set just one and we warn + fall back to committing under public/.
const PUBLIC_BASE = (process.env.PUBLIC_R2_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_BUCKET = process.env.R2_PUBLIC_BUCKET_NAME || '';
const REMOTE_PUBLIC = REMOTE && !!PUBLIC_BASE && !!PUBLIC_BUCKET;
const FORCE_UPLOAD = /^(1|true)$/i.test(process.env.R2_FORCE_UPLOAD || '');
if (REMOTE && !REMOTE_PUBLIC && (PUBLIC_BASE || PUBLIC_BUCKET)) {
  console.warn(`  ⚠ public-asset serving needs BOTH R2_PUBLIC_BUCKET_NAME (${PUBLIC_BUCKET || 'unset'}) and PUBLIC_R2_BASE_URL (${PUBLIC_BASE || 'unset'}); committing covers/reports to public/ for now.`);
}

// Lazy-load the R2 uploader only in remote mode (keeps local ingest dependency-free).
let uploadObject = null;
let headObjectMeta = null;
if (REMOTE) {
  try { ({ uploadObject, headObjectMeta } = await import('./uploadR2.mjs')); }
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

// Resolve a public/ asset path to the URL the site references. In remote-public mode the
// asset lives on the public R2 bucket and is served from PUBLIC_R2_BASE_URL (cdn.lufsaud.io);
// otherwise it's committed under public/ and served from the site root. Accepts a path
// with or without a leading slash; the bucket key is the same path minus the slash.
const assetUrl = (rel) => {
  const clean = String(rel).replace(/^\/+/, '');
  return REMOTE_PUBLIC ? `${PUBLIC_BASE}/${clean}` : `/${clean}`;
};

// Best-effort Content-Type for a public-bucket object (R2 has no extension sniffing).
const CTYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
};
const ctype = (name) => CTYPES[(name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()] || 'application/octet-stream';

function copy(src, dest) {
  if (!existsSync(src)) { warn(`missing source: ${src}`); return false; }
  if (statSync(src).isDirectory()) return false;
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  return true;
}
function copyTree(srcDir, destDir, { skipWav = true, skipGif = false, skipMp4 = false } = {}) {
  if (!existsSync(srcDir)) return;
  for (const name of readdirSync(srcDir)) {
    if (isIgnored(name)) continue;
    const s = join(srcDir, name);
    const d = join(destDir, name);
    if (statSync(s).isDirectory()) copyTree(s, d, { skipWav, skipGif, skipMp4 });
    else if (skipWav && /\.wav$/i.test(name)) continue;
    else if (skipGif && /\.gif$/i.test(name)) continue;  // 45MB Spotify-canvas GIF — never ship
    else if (skipMp4 && /\.mp4$/i.test(name)) continue;   // canvas video — heavy, not used by the site
    else copy(s, d);
  }
}

// Upload a local directory (under public/) to the PUBLIC R2 bucket, keyed by its path
// relative to public/ so the served URL (PUBLIC_R2_BASE_URL + key) matches what the
// markdown references. Skips re-upload when the object already exists at the SAME byte
// size (covers/reports are deterministic — identical size ⇒ identical content here),
// unless R2_FORCE_UPLOAD=1. Same-key PUTs overwrite, so R2 storage never grows on
// re-ingest. Returns { uploaded, skipped }.
async function uploadPublicDir(absDir) {
  const stats = { uploaded: 0, skipped: 0 };
  if (!existsSync(absDir) || !uploadObject) return stats;
  const walk = async (dir) => {
    for (const name of readdirSync(dir)) {
      if (isIgnored(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { await walk(p); continue; }
      const key = relative(PUBLIC_DIR, p).split(sep).join('/'); // POSIX key regardless of OS
      if (!FORCE_UPLOAD && headObjectMeta) {
        try {
          const head = await headObjectMeta(key, { bucket: PUBLIC_BUCKET });
          if (head && Number(head.contentLength) === statSync(p).size) { stats.skipped++; continue; }
        } catch { /* HEAD failed — fall through and upload */ }
      }
      await uploadObject(p, key, ctype(name), { bucket: PUBLIC_BUCKET });
      stats.uploaded++;
    }
  };
  await walk(absDir);
  return stats;
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
// Always strips original-quality audio and download affordances (the "no-downloads"
// guarantee). The canvas video + GIF are HEAVY: they're kept only when keepCanvas is set
// (remote-public mode, where the report's sibling assets are uploaded to the public CDN
// and the report renders in full); otherwise they're stripped so we never commit them.
function sanitizeReport(html, { keepCanvas = false } = {}) {
  if (parseHTML) {
    const root = parseHTML(html);
    // Removing <audio> takes its <source> children with it.
    root.querySelectorAll('audio').forEach((el) => el.remove());
    if (!keepCanvas) {
      root.querySelectorAll('video').forEach((el) => el.remove());
      root.querySelectorAll('img').forEach((el) => {
        if ((el.getAttribute('src') || '').toLowerCase().endsWith('.gif')) el.remove(); // canvas GIF
      });
    }
    // Any standalone media <source> pointing at downloadable audio (kept-video <source>s
    // use .mp4, so the canvas survives keepCanvas mode).
    root.querySelectorAll('source').forEach((el) => {
      const src = (el.getAttribute('src') || '').toLowerCase();
      if (src.endsWith('.wav') || src.endsWith('.mp3')) el.remove();
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
  // Regex fallback (node-html-parser unavailable).
  let out = html
    .replace(/<audio[\s\S]*?<\/audio>/gi, '')
    .replace(/<source\b[^>]*(?:\.wav|\.mp3)[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="[^"]*\.(wav|mp3)"[^>]*>[\s\S]*?<\/a>/gi, '');
  if (!keepCanvas) {
    out = out
      .replace(/<video[\s\S]*?<\/video>/gi, '')
      .replace(/<img\b[^>]*src="[^"]*\.gif"[^>]*>/gi, '');
  }
  return out;
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

  // Track identity comes from the OUTPUT DIR NAME, never ctx.input_name. The workchain
  // threads each step's output forward, so by the end of the chain ctx.input_name /
  // input_ext describe the LAST step's output (catalog/catalog_info.txt -> "catalog_info"
  // / "txt"), NOT the track. catalog-process.sh names the dir `{track}_astro-catalog/`
  // and the normalized file `{track}_normalized.<ext>`, so the dir is the source of truth.
  const name = basename(acDir).replace(/_astro-catalog$/i, '');

  // Discover the real artifacts by suffix rather than reconstructing paths from ctx —
  // robust to a clobbered input_name, to varying audio extensions (wav/mp3/aiff/m4a…),
  // and to whatever the chain named each file.
  const AUDIO = /_normalized\.(wav|mp3|aiff|aif|m4a|flac|ogg)$/i;
  const list = (d) => (existsSync(d) ? readdirSync(d) : []);
  const here = list(acDir);
  const norm = here.find((f) => f.startsWith(`${name}_normalized.`) && AUDIO.test(f))
            || here.find((f) => AUDIO.test(f));
  const normalizedWav = join(acDir, norm || `${name}_normalized.wav`);
  const ext = norm ? norm.split('.').pop().toLowerCase() : 'wav';

  const rep = here.find((f) => f === `${name}_report.html`) || here.find((f) => /_report\.html$/i.test(f));
  const reportHtml = join(acDir, rep || `${name}_report.html`);

  const artList = list(join(acDir, 'artwork'));
  const art = artList.find((f) => f === `${name}_artwork.png`) || artList.find((f) => /_artwork\.png$/i.test(f));
  const artworkMain = join(acDir, 'artwork', art || `${name}_artwork.png`);

  const canvasList = list(join(acDir, 'canvas'));
  const can = canvasList.find((f) => f === `${name}_canvas_static.png`) || canvasList.find((f) => /_canvas_static\.png$/i.test(f));
  const canvasStatic = join(acDir, 'canvas', can || `${name}_canvas_static.png`);

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
    name, ext, acDir, normalizedWav, reportHtml, artworkMain, canvasStatic,
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
    const key = `releases/${collectionId}/${n}/${base}.mp3`;
    // Skip the transcode + upload when R2 already holds this exact source — matched by
    // the source SHA-256 we stamp as object metadata. Saves upload bandwidth + CPU on
    // re-ingests (and re-uploads automatically if the source changed). R2_FORCE_UPLOAD=1
    // forces a re-upload regardless.
    let head = null;
    if (!FORCE_UPLOAD && headObjectMeta && m.sha256) {
      try { head = await headObjectMeta(key); }
      catch (e) { warn(`HEAD ${key} failed (${e.message}); will upload`); }
    }
    if (head && head.metadata?.source_sha256 && head.metadata.source_sha256 === m.sha256) {
      duration = Number(head.metadata.duration) || 0;
      log(`    = R2 (unchanged)  ${key}`);
    } else if (uploadObject) {
      const tmpMp3 = join(tmpdir(), `lufs-${slugify(collectionId)}-${n}-${base}.mp3`);
      transcodeMp3(m.normalizedWav, tmpMp3);
      duration = ffprobeDuration(tmpMp3);
      await uploadObject(tmpMp3, key, 'audio/mpeg', { metadata: { source_sha256: m.sha256 || '', duration } });
      rmSync(tmpMp3, { force: true });
    } else {
      warn('remote mode but uploader unavailable; audio not uploaded');
    }
    audioPath = key; // the player exchanges this key for a signed URL via the Worker
  } else {
    const audioDest = join(PUBLIC_DIR, 'audio', collectionId, n, `${base}.mp3`);
    transcodeMp3(m.normalizedWav, audioDest);
    duration = ffprobeDuration(audioDest);
    audioPath = `/audio/${collectionId}/${n}/${base}.mp3`;
  }

  // 2) sanitized report + its relative assets (no WAV, no canvas GIF) so links resolve.
  //    The report is OPTIONAL: the astro-catalog chain only emits `{name}_report.html`
  //    when run with `--report`. When it's absent we leave finalReport empty so the UI
  //    hides the link instead of publishing a guaranteed 404 (see [slug].astro).
  const hasReport = existsSync(m.reportHtml);
  if (hasReport) {
    ensureDir(reportDir);
    // Keep the canvas video + GIF only in remote-public mode, where the report's sibling
    // assets are uploaded to the public CDN and the report renders in full fidelity;
    // otherwise strip them (we never commit heavy media to git).
    writeFileSync(
      join(reportDir, 'final_report.html'),
      sanitizeReport(readFileSync(m.reportHtml, 'utf8'), { keepCanvas: REMOTE_PUBLIC }),
    );
    for (const sub of ['artwork', 'canvas', 'logs']) {
      copyTree(join(m.acDir, sub), join(reportDir, sub), { skipWav: true, skipGif: !REMOTE_PUBLIC, skipMp4: !REMOTE_PUBLIC });
    }
  } else { warn(`report not found (re-run the chain with --report to include it): ${m.reportHtml}`); }

  // 3) covers for the site UI
  copy(m.artworkMain, join(coverDir, 'artwork.png'));
  const comp = join(m.acDir, 'artwork', 'components');
  for (const f of ['identicon.png', 'spectrogram.png', 'rectangle_spectrogram.png']) copy(join(comp, f), join(coverDir, f));
  copy(m.canvasStatic, join(coverDir, 'canvas_static.png'));

  return {
    trackNumber,
    displayTitle: m.name,
    filename: base,
    catalogNumber: m.catalogNumber,
    sha256: m.sha256,
    processedDate: m.processedDate,
    saturation: m.saturation,
    audioPath,
    finalReport: hasReport ? assetUrl(`/reports/${collectionId}/${n}/final_report.html`) : '',
    duration,
    loudness: m.loudness,
    artwork: {
      main: assetUrl(`/covers/${collectionId}/${n}/artwork.png`),
      identicon: assetUrl(`/covers/${collectionId}/${n}/identicon.png`),
      spectrogram: assetUrl(`/covers/${collectionId}/${n}/spectrogram.png`),
      canvasStatic: assetUrl(`/covers/${collectionId}/${n}/canvas_static.png`),
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
    // Emit an explicit empty array, not a bare `tags:` (which YAML reads as null
    // and the content schema then rejects). Same care anywhere a list can be empty.
    ...((data.tags && data.tags.length)
      ? ['tags:', ...data.tags.map((t) => `  - ${q(t)}`)]
      : ['tags: []']),
    'tracks:',
    trackYaml,
    '---',
    '',
  ].join('\n');

  ensureDir(CONTENT_DIR);
  writeFileSync(join(CONTENT_DIR, `${slug}.md`), body);
}

// Publish policy. Remote (prod): default to `released` so confirmed-on-R2 tracks go
// live without manual flipping; honor an explicit `unreleased` (deliberate withhold)
// and an explicit `released`. Local: preserve the human status, default `draft`.
// To keep a release off the live site, set its frontmatter `status: unreleased`.
function decideStatus(remote, humanStatus) {
  if (remote) return humanStatus === 'unreleased' ? 'unreleased' : 'released';
  return humanStatus || 'draft';
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
  if (REMOTE) log(`  remote: audio → R2 "${process.env.R2_BUCKET_NAME || '(R2_BUCKET_NAME unset)'}" (private, signed at play time).`);
  if (REMOTE_PUBLIC) log(`  remote: covers + reports → R2 "${PUBLIC_BUCKET}" (public), served from ${PUBLIC_BASE} (local copies removed after upload).`);
  else if (REMOTE) log('  remote: covers + reports committed to public/ (set R2_PUBLIC_BUCKET_NAME + PUBLIC_R2_BASE_URL to serve them from a CDN instead).');
  if (REMOTE) log('  publish: status=released by default; set a release\'s status to "unreleased" to keep it off the site (re-ingest preserves it).');

  let albums = listDirs(SRC).map((d) => d.name).sort();
  if (ONLY) albums = albums.filter((n) => n === ONLY);

  const processed = [];
  const skipped = [];

  for (const dirName of albums) {
    const albumPath = join(SRC, dirName);
    const { collectionId, slug } = deriveIds(dirName);
    // collectionId is used verbatim in /audio|reports|covers/<id>/ paths. Dots,
    // underscores and case are URL-safe; spaces and the like are not. Warn (don't
    // mangle) so the operator can rename the album folder if needed.
    if (/[^A-Za-z0-9._-]/.test(collectionId)) {
      warn(`album "${dirName}" has URL-unsafe characters; consider renaming the folder (track names are slugified, but album folder names are used verbatim in paths/keys).`);
    }
    const found = findAstroTracks(albumPath);
    log(`\nalbum: ${dirName}  (${found.length} astro-catalog track(s))`);

    if (!found.length) {
      warn(`no *_astro-catalog/ output in ${dirName} — skipping (run it through the lufs-workchain first).`);
      skipped.push(`${dirName} (unprocessed)`);
      continue;
    }

    // Clean this collection's published assets first, so stale files from older runs
    // (e.g. a legacy WAV, a 45MB canvas GIF, or render_stats.html) don't linger + ship.
    // Audio in remote mode lives on R2, not public/; in local mode it's re-transcoded.
    if (collectionId) {
      for (const sub of ['reports', 'covers']) rmSync(join(PUBLIC_DIR, sub, collectionId), { recursive: true, force: true });
    }

    const tracks = [];
    for (const t of found) {
      try {
        const track = await processAstroTrack(collectionId, tracks.length + 1, t.acDir);
        if (track) tracks.push(track); // null = incomplete/failed run, skipped
      } catch (e) {
        // One bad track (e.g. a corrupt/zero-byte normalized file that fails ffmpeg)
        // must NEVER abort the whole catalog ingest. Skip it loudly and continue.
        warn(`track failed in "${dirName}" (${t.dirName}): ${e.message} — skipping`);
      }
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
      status: decideStatus(REMOTE, human.status),
      coverArt: assetUrl(`/covers/${collectionId}/cover.png`),
      isrc: human.isrc || '',
      streamingLinks: human.streamingLinks,
      tags: human.tags || [],
      tracks,
    });
    log(`  ✓ wrote src/content/releases/${slug}.md  (${tracks.length} track(s), status=${human.status || 'draft'})`);

    // Remote-public: push this collection's covers + reports to the PUBLIC R2 bucket
    // (served from PUBLIC_R2_BASE_URL) and drop the local copies, so neither git nor the
    // Hostinger deploy branch carries heavy assets. Same-key PUTs overwrite ⇒ no R2 growth.
    if (REMOTE_PUBLIC) {
      const cov = await uploadPublicDir(join(PUBLIC_DIR, 'covers', collectionId));
      const rep = await uploadPublicDir(join(PUBLIC_DIR, 'reports', collectionId));
      log(`  ↑ public R2 (${PUBLIC_BUCKET}): covers ${cov.uploaded} up/${cov.skipped} unchanged, reports ${rep.uploaded} up/${rep.skipped} unchanged → ${PUBLIC_BASE}`);
      for (const sub of ['covers', 'reports']) rmSync(join(PUBLIC_DIR, sub, collectionId), { recursive: true, force: true });
    }

    processed.push(`${slug} <- ${dirName} (${tracks.length} track(s))`);
  }

  log('\n=== summary ===');
  log(`processed: ${processed.length ? processed.join('; ') : '(none)'}`);
  log(`skipped  : ${skipped.length ? skipped.join('; ') : '(none)'}`);
}

// Run only when invoked directly (`node catalog-ingest.mjs`); stay importable so
// the unit tests can exercise the pure helpers without running a full ingest.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => { console.error('FATAL', e); process.exit(1); });
}

export { slugify, deriveIds, sanitizeReport, parseAstroCatalog, findAstroTracks, decideStatus };
