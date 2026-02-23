import { readFileSync } from 'fs';
import { parse as parseHTML } from 'node-html-parser';

/**
 * Parse _final_report.html and extract metadata
 * Extracts: catalogNumber, sha256, processedDate, saturation, filename
 */
export function parseFinalReport(html) {
  const root = parseHTML(html);
  const text = root.text;

  // Extract fields from the report
  // Regex patterns match common HTML report formats
  const catalogNumberMatch = text.match(/Catalog Number:\s*(lufs-[a-f0-9]+)/i);
  const sha256Match = text.match(/Full SHA256 Hash:\s*([a-f0-9]{64})/i);
  const processedDateMatch = text.match(/Processed:\s*(.+?)(?:\n|$)/i);
  const saturationMatch = text.match(/Saturation:\s*([\d.]+)/i);
  const filenameMatch = text.match(/File:\s*(\S+\.wav)/i);

  // Parse date to ISO format if possible
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

/**
 * Sanitize final report HTML for embedding
 * Removes download buttons/links to prevent accidental downloads
 */
export function sanitizeFinalReport(html) {
  const root = parseHTML(html);
  
  // Remove download buttons and links
  root.querySelectorAll('a[download], button.btn-download, a[href*=".wav"], a[href*=".mp3"]').forEach(el => {
    el.remove();
  });
  
  // Remove any links with "download" in text
  root.querySelectorAll('a').forEach(el => {
    if (el.text?.toLowerCase().includes('download')) {
      el.remove();
    }
  });
  
  return root.toString();
}

/**
 * Extract duration from render_stats.html or use ffprobe fallback
 * For now, defaults to 0; implement ffprobe if needed in production
 */
export function getAudioDuration(mp3Path) {
  try {
    // TODO: Implement ffprobe if audio files are available locally
    console.log(`  Note: Duration parsing not implemented (ffprobe not found or mp3Path invalid)`);
    return 0;
  } catch {
    return 0;
  }
}
