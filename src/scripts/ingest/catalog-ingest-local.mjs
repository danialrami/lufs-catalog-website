#!/usr/bin/env node
/**
 * catalog-ingest-local.mjs — Local-only ingestion script for LUFS Audio Catalog
 * 
 * Reads from CATALOG_SOURCE_PATH (default: /Volumes/project/continuo/catalogs)
 * Copies assets to public/audio/, public/reports/, public/covers/
 * Updates/creates src/content/releases/*.md files with local paths
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { parse } from 'node-html-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// --- ESM compatibility ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---

const CATALOG_SOURCE_PATH = process.env.CATALOG_SOURCE_PATH || '/Volumes/project/continuo/catalogs';
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PUBLIC_DIR = join(REPO_ROOT, 'public');
const CONTENT_DIR = join(REPO_ROOT, 'src', 'content', 'releases');

// --- Path helpers ---

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function copyAsset(src, dest) {
  if (!existsSync(src)) {
    console.warn(`    Source not found: ${src}`);
    return;
  }
  if (statSync(src).isDirectory()) {
    console.warn(`    Skipping directory: ${src}`);
    return;
  }
  ensureDir(dirname(dest));
  const content = readFileSync(src);
  writeFileSync(dest, content);
  console.log(`    Copied: ${dest}`);
}

export function parseFinalReport(html) {
  const root = parse(html);
  const text = root.text;

  const catalogNumberMatch = text.match(/Catalog Number:\s*(lufs-[a-f0-9]+)/i);
  const sha256Match = text.match(/Full SHA256 Hash:\s*([a-f0-9]{64})/i);
  const processedDateMatch = text.match(/Processed:\s*(.+?)(?:\n|$)/i);
  const saturationMatch = text.match(/Saturation:\s*([\d.]+)/i);
  const filenameMatch = text.match(/File:\s*(\S+\.wav)/i);

  let processedDate = new Date();
  if (processedDateMatch?.[1]) {
    try {
      processedDate = new Date(processedDateMatch[1].trim());
    } catch (e) {
      console.warn(`  Warning: Could not parse date: ${processedDateMatch[1]}`);
    }
  }

  return {
    catalogNumber: catalogNumberMatch?.[1] || '',
    sha256: sha256Match?.[1] || '',
    processedDate,
    saturation: parseFloat(saturationMatch?.[1] || '0'),
    filename: filenameMatch?.[1]?.replace('.wav', '') || '',
  };
}

export function sanitizeFinalReport(html) {
  const root = parse(html);
  
  root.querySelectorAll('a[download], button.btn-download, a[href*=".wav"], a[href*=".mp3"]').forEach(el => {
    el.remove();
  });
  
  root.querySelectorAll('a').forEach(el => {
    if (el.text?.toLowerCase().includes('download')) {
      el.remove();
    }
  });
  
  return root.toString();
}

export function getAudioDuration(mp3Path) {
  try {
    console.log(`  Note: Duration parsing not implemented (ffprobe not found or mp3Path invalid)`);
    return 0;
  } catch {
    return 0;
  }
}

function walkCollections() {
  if (!existsSync(CATALOG_SOURCE_PATH)) {
    console.error(`Error: CATALOG_SOURCE_PATH not found: ${CATALOG_SOURCE_PATH}`);
    process.exit(1);
  }

  const collections = [];
  const entries = readdirSync(CATALOG_SOURCE_PATH, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    
    const match = entry.name.match(/^([a-f0-9]+)_(.+)$/);
    if (match) {
      collections.push({
        collectionId: entry.name,
        hashPrefix: match[1],
        bip39Slug: match[2],
        basePath: join(CATALOG_SOURCE_PATH, entry.name),
      });
    }
  }

  console.log(`Found ${collections.length} collection(s) in ${CATALOG_SOURCE_PATH}`);
  return collections;
}

function processTrack(collection, trackDir) {
  // Find the _final directory within the track directory (pattern: *_final)
  const trackContents = readdirSync(trackDir.path, { withFileTypes: true });
  const finalDir = trackContents.find(d => d.isDirectory() && d.name.endsWith('_final'));
  
  if (!finalDir) {
    console.warn(`  Track ${trackDir.number}: _final directory not found`);
    return null;
  }

  const finalDirPath = join(trackDir.path, finalDir.name);
  const finalReportPath = join(finalDirPath, `${finalDir.name}_report.html`);
  
  if (!existsSync(finalReportPath)) {
    console.warn(`  Track ${trackDir.number}: _final_report.html not found at ${finalReportPath}`);
    return null;
  }

  // Find any .mp3 file in the track directory
  const mp3File = trackContents.find(f => f.isFile() && f.name.endsWith('.mp3'));
  if (!mp3File) {
    console.warn(`  Track ${trackDir.number}: .mp3 not found`);
    return null;
  }

  const mp3Path = join(trackDir.path, mp3File.name);

  const html = readFileSync(finalReportPath, 'utf-8');
  const parsedData = parseFinalReport(html);

  const collectionId = collection.collectionId;
  const trackNum = trackDir.number;
  
  ensureDir(join(PUBLIC_DIR, 'audio', collectionId, `${trackNum}`));
  ensureDir(join(PUBLIC_DIR, 'reports', collectionId, `${trackNum}`));
  ensureDir(join(PUBLIC_DIR, 'covers', collectionId, `${trackNum}`));

  // Use actual mp3 filename from source
  const mp3Filename = mp3File.name.replace('.mp3', '');
  const destAudio = join(PUBLIC_DIR, 'audio', collectionId, `${trackNum}`, `${mp3Filename}.mp3`);
  copyAsset(mp3Path, destAudio);

  const sanitizedHtml = sanitizeFinalReport(html);
  const destFinalReport = join(PUBLIC_DIR, 'reports', collectionId, `${trackNum}`, 'final_report.html');
  writeFileSync(destFinalReport, sanitizedHtml);

  // Use finalDir.name for artwork path
  const artworkSrc = join(trackDir.path, finalDir.name, 'artwork');
  if (existsSync(artworkSrc)) {
    const artworkFiles = readdirSync(artworkSrc);
    for (const file of artworkFiles) {
      copyAsset(join(artworkSrc, file), join(PUBLIC_DIR, 'covers', collectionId, `${trackNum}`, file));
    }
  }

  // Find render_stats.html in track directory
  const renderStatsFile = trackContents.find(f => f.isFile() && f.name.endsWith('.render_stats.html'));
  let renderStatsPathLocal = undefined;
  if (renderStatsFile) {
    const renderStatsPath = join(trackDir.path, renderStatsFile.name);
    const destRenderStats = join(PUBLIC_DIR, 'reports', collectionId, `${trackNum}`, 'render_stats.html');
    copyAsset(renderStatsPath, destRenderStats);
    renderStatsPathLocal = `/reports/${collectionId}/${trackNum}/render_stats.html`;
  }

  const collectionArtworkSrc = join(collection.basePath, 'artwork');
  let coverArtPath = '';
  if (existsSync(collectionArtworkSrc)) {
    const artworkFiles = readdirSync(collectionArtworkSrc);
    if (artworkFiles.length > 0) {
      const mainArtwork = artworkFiles.find(f => f.endsWith('.png')) || artworkFiles[0];
      const destCover = join(PUBLIC_DIR, 'covers', collectionId, `${mainArtwork}`);
      copyAsset(join(collectionArtworkSrc, mainArtwork), destCover);
      coverArtPath = `/covers/${collectionId}/${mainArtwork}`;
    }
  }

  return {
    trackNumber: trackNum,
    displayTitle: parsedData.filename || `Track ${trackNum}`,
    filename: mp3Filename,
    catalogNumber: parsedData.catalogNumber,
    sha256: parsedData.sha256,
    processedDate: parsedData.processedDate.toISOString(),
    saturation: parsedData.saturation || 0,
    audioPath: `/audio/${collectionId}/${trackNum}/${mp3Filename}.mp3`,
    renderStatsPath: renderStatsPathLocal,
    finalReport: `/reports/${collectionId}/${trackNum}/final_report.html`,
    duration: 0,
    artwork: {
      main: coverArtPath || `/covers/${collectionId}/artwork.png`,
    },
  };
}

function readReleaseMarkdown(slug) {
  const filePath = join(CONTENT_DIR, `${slug}.md`);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

function writeReleaseMarkdown(slug, data) {
  const filePath = join(CONTENT_DIR, `${slug}.md`);
  
  const tracksYaml = data.tracks.map(track => `- trackNumber: ${track.trackNumber}
    displayTitle: "${track.displayTitle}"
    filename: "${track.filename}"
    catalogNumber: "${track.catalogNumber}"
    sha256: "${track.sha256}"
    processedDate: "${track.processedDate}"
    saturation: ${track.saturation}
    # LOCAL PATHS - for production, replace with R2 URLs
    audioPath: "${track.audioPath}"
    ${track.renderStatsPath ? `renderStatsPath: "${track.renderStatsPath}"` : ''}
    finalReport: "${track.finalReport}"
    duration: ${track.duration}
    artwork:
      main: "${track.artwork?.main || ''}"
`).join('\n');

  const yamlHeader = `---
title: "${data.title}"
collectionId: "${data.collectionId}"
project: "${data.project}"
artist: "${data.artist || 'Daniel Ramirez'}"
releaseDate: ${data.releaseDate.toISOString().split('T')[0]}
status: "${data.status}"
coverArt: "${data.coverArt || ''}"
${data.isrc ? `isrc: "${data.isrc}"` : ''}
streamingLinks:
  spotify: ""
  appleMusic: ""
  bandcamp: ""
  soundcloud: ""
tags:
${data.tags.map(t => `  - "${t}"`).join('\n')}
tracks:
${tracksYaml}
---`;

  writeFileSync(filePath, yamlHeader.trim() + '\n');
  console.log(`  ✓ Written: ${filePath}`);
}

async function promptForMetadata() {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log('\n--- Missing Release Metadata ---');
  
  const title = await question('Title (e.g., "Continuo"): ');
  const releaseDate = await question('Release Date (YYYY-MM-DD): ') || new Date().toISOString().split('T')[0];
  const isrc = await question('ISRC (leave blank if unknown): ') || '';
  const project = await question('Project name (e.g., "Continuo"): ');
  const tagsInput = await question('Tags (comma-separated, e.g., "ambient,piano"): ');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()) : [];
  
  rl.close();

  return { title, releaseDate, isrc, project, tags };
}

async function handleRelease(collectionId, tracks) {
  const bip39Slug = collectionId.split('_').slice(1).join('-');
  const existingMarkdown = readReleaseMarkdown(bip39Slug);

  if (existingMarkdown) {
    console.log(`  Updating existing release: ${bip39Slug}`);
    
    // Simple merge for now - in production, parse YAML properly
    // For existing releases, just update tracks array
  } else {
    console.log(`  Creating new release: ${bip39Slug}`);
    
    const metadata = await promptForMetadata();

    const releaseData = {
      title: metadata.title,
      collectionId,
      project: metadata.project || 'Continuo',
      artist: 'Daniel Ramirez',
      releaseDate: new Date(metadata.releaseDate),
      status: 'released',
      coverArt: `/covers/${collectionId}/artwork.png`,
      isrc: metadata.isrc,
      tags: metadata.tags,
      tracks,
    };
    
    await writeReleaseMarkdown(bip39Slug, releaseData);
  }
}

async function main() {
  console.log('=== LUFS Audio Catalog - Local Ingest Script ===');
  console.log(`Source path: ${CATALOG_SOURCE_PATH}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Content dir: ${CONTENT_DIR}\n`);

  const collections = walkCollections();

  if (collections.length === 0) {
    console.log('No collections found. Exiting.');
    return;
  }

  for (const collection of collections) {
    try {
      const trackDirs = readdirSync(collection.basePath, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
        .map(d => ({ number: parseInt(d.name, 10), path: join(collection.basePath, d.name) }))
        .sort((a, b) => a.number - b.number);

      console.log(`\nProcessing collection: ${collection.collectionId}`);
      console.log(`  Found ${trackDirs.length} track(s)`);

      const tracks = [];
      for (const trackDir of trackDirs) {
        const trackMetadata = processTrack(collection, trackDir);
        if (trackMetadata) {
          tracks.push(trackMetadata);
        }
      }

      if (tracks.length > 0) {
        await handleRelease(collection.collectionId, tracks);
      }
    } catch (err) {
      console.error(`Error processing collection ${collection.collectionId}:`, err);
    }
  }

  console.log('\n=== Ingest complete ===');
  console.log('Release files created in:', CONTENT_DIR);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
