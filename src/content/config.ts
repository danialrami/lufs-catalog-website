import { defineCollection, z } from 'astro:content';

const trackSchema = z.object({
  trackNumber: z.number().int().positive(),
  displayTitle: z.string(),
  filename: z.string(),
  catalogNumber: z.string(),
  sha256: z.string().length(64),
  processedDate: z.coerce.date(),
  saturation: z.number().optional(),
  
  // *** Local Paths (local-only dev) ***
  // For production with Cloudflare R2, replace these with public URLs like:
  // audioPath: 'https://pub-xxxx.r2.dev/releases/[collectionId]/[trackNumber]/[filename].mp3'
  audioPath: z.string(),
  
  // Optional render stats path (local path or R2 URL)
  // For production: 'https://pub-xxxx.r2.dev/reports/[collectionId]/[trackNumber]/render_stats.html'
  renderStatsPath: z.string().optional(),
  
  // Final report path (must be available for embedding)
  // For production: 'https://pub-xxxx.r2.dev/reports/[collectionId]/[trackNumber]/final_report.html'
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
      spotify: z.string().url().optional(),
      appleMusic: z.string().url().optional(),
      bandcamp: z.string().url().optional(),
      soundcloud: z.string().url().optional(),
    }).optional(),
    tags: z.array(z.string()).default([]),
    tracks: z.array(trackSchema).default([]),
  }),
});

export const collections = { releases };
