/**
 * resolveAudio.ts — turn a track's stored audio reference into a playable URL.
 *
 * Local mode: audioPath is a direct URL ("/audio/…") → returned as-is.
 * Remote mode (R2): audioPath is a private key ("releases/…") → exchanged for a
 * short-lived presigned URL from the signing Worker (PUBLIC_R2_STREAM_URL).
 *
 * The NAS rustfs failover is included but commented until the endpoint exists
 * (see docs/implementation/07-nas-rustfs-fallback.md).
 */

// Production signing Worker. Used as a fallback when PUBLIC_R2_STREAM_URL is not baked
// into the build (e.g. a CI build missing the repo Variable or the build-step env block)
// so audio can't silently break from a build-config slip. Any deploy can override it by
// setting PUBLIC_R2_STREAM_URL at build time.
const DEFAULT_STREAM_WORKER = 'https://stream.lufsaud.io';

export function isDirectUrl(ref: string): boolean {
  return ref.startsWith('/') || /^https?:\/\//i.test(ref) || ref.startsWith('blob:') || ref.startsWith('data:');
}

export async function resolveAudioUrl(ref: string): Promise<string> {
  if (!ref) throw new Error('resolveAudioUrl: empty ref');
  if (isDirectUrl(ref)) return ref; // local path or already-public URL — no signing

  // Otherwise treat `ref` as a private R2 key and ask the Worker to sign it.
  const worker = ((import.meta as any).env?.PUBLIC_R2_STREAM_URL as string | undefined) || DEFAULT_STREAM_WORKER;

  try {
    const res = await fetch(`${worker}?key=${encodeURIComponent(ref)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`stream worker ${res.status}`);
    const { url } = await res.json();
    if (!url) throw new Error('stream worker returned no url');
    return url;
  } catch (err) {
    // --- NAS rustfs failover (disabled until PUBLIC_RUSTFS_STREAM_URL is set) ---
    // const fb = (import.meta as any).env?.PUBLIC_RUSTFS_STREAM_URL as string | undefined;
    // if (fb) {
    //   const res = await fetch(`${fb}?key=${encodeURIComponent(ref)}`);
    //   if (res.ok) { const { url } = await res.json(); if (url) return url; }
    // }
    throw err;
  }
}
