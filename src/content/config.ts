import { defineCollection, z } from 'astro:content';

const trackSchema = z.object({
  trackNumber: z.number().int().positive(),
  displayTitle: z.string(),
  filename: z.string(),
  catalogNumber: z.string(),

  // Content hash from the workchain catalog step (catalog/catalog_info.txt).
  // Tolerant of an empty string so a single track whose catalog_info.txt is
  // missing/unreadable degrades to a hash-less entry instead of failing the
  // WHOLE `astro build`. A present value must still be a real 64-char SHA-256.
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).or(z.literal('')),

  processedDate: z.coerce.date(),
  saturation: z.number().optional(),

  // Loudness metadata from the workchain (astro-catalog logs/normalization.json).
  // Optional so legacy/album releases without it still validate.
  loudness: z.object({
    targetLufs: z.number().optional(),
    finalLufs: z.number().optional(),
    truePeak: z.number().optional(),
    lra: z.number().optional(),
    sampleRate: z.number().optional(),
    channels: z.number().optional(),
  }).optional(),

  // *** Storage-agnostic URL/key fields ***
  // Local dev: '/audio/[collectionId]/[trackNumber]/[filename].mp3'
  // R2 (Phase 2): the player resolves the key via the signing Worker.
  audioPath: z.string(),

  // Optional render stats (legacy REAPER export; astro-catalog has none)
  renderStatsPath: z.string().optional(),

  // Final report path (embedded, sanitized) — local path or public R2 URL.
  // EMPTY when the workchain run had no `--report` output; the UI hides the
  // link/iframe in that case (see src/pages/releases/[slug].astro).
  finalReport: z.string().default(''),

  duration: z.number().default(0),

  artwork: z.object({
    main: z.string().optional(),
    identicon: z.string().optional(),
    spectrogram: z.string().optional(),
    canvasStatic: z.string().optional(),
  }).optional(),
});

const releases = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    collectionId: z.string(),
    project: z.string(),
    artist: z.string().default('Daniel Ramirez'),
    releaseDate: z.coerce.date(),
    status: z.enum(['released', 'unreleased', 'draft']).default('released'),
    coverArt: z.string(),
    isrc: z.string().optional(),
    streamingLinks: z.object({
      spotify: z.string().url().optional().or(z.literal('')),
      appleMusic: z.string().url().optional().or(z.literal('')),
      bandcamp: z.string().url().optional().or(z.literal('')),
      soundcloud: z.string().url().optional().or(z.literal('')),
    }).optional(),
    // Tolerate a bare `tags:` / `tracks:` (which YAML parses as null, not []):
    // an empty list or a hand-edit can serialize that way, and a plain
    // `.default([])` only fills `undefined` — so null would otherwise hard-fail
    // the whole `astro build`. Coerce null/undefined → [] before validating.
    tags: z.preprocess((v) => (v == null ? [] : v), z.array(z.string())),
    tracks: z.preprocess((v) => (v == null ? [] : v), z.array(trackSchema)),
  }),
});

export const collections = { releases };
