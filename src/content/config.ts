import { defineCollection, z } from 'astro:content';

const trackSchema = z.object({
  trackNumber: z.number().int().positive(),
  displayTitle: z.string(),
  filename: z.string(),
  catalogNumber: z.string(),
  sha256: z.string().length(64),
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

  // Final report path (embedded, sanitized) — local path or public R2 URL
  finalReport: z.string(),

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
    tags: z.array(z.string()).default([]),
    tracks: z.array(trackSchema).default([]),
  }),
});

export const collections = { releases };
