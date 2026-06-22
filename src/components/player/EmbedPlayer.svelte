<script lang="ts">
  /**
   * EmbedPlayer — a compact, self-contained player for the iframe embed (`/embed/{id}`).
   *
   * Reuses the catalog's audio ENGINE (resolveAudioUrl + Howler via useHowler) and the LUFS
   * visual tokens, but is intentionally NOT the site's PlayerBar: an embed lives in an
   * isolated cross-origin iframe, so it must be a single contained card with no global
   * singleton, no localStorage, no ViewTransitions, no fixed positioning. Audio is loaded
   * lazily on first play so a page with many embeds doesn't fetch every track at once.
   */
  import { onDestroy } from 'svelte';
  import { Howl } from 'howler';
  import { resolveAudioUrl, isDirectUrl } from './resolveAudio';

  export let audioPath: string;       // R2 key ("releases/…") or a direct URL
  export let title: string;
  export let catalogNumber = '';
  export let cover: string | undefined = undefined;
  export let releaseUrl = '';         // absolute link back to the catalog

  let howl: Howl | null = null;
  let isPlaying = false;
  let loading = false;
  let errored = false;
  let duration = 0;
  let position = 0;
  let raf = 0;

  function fmt(s: number): string {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function loop() {
    if (howl && howl.playing()) {
      position = howl.seek() as number;
      raf = requestAnimationFrame(loop);
    }
  }

  async function ensureHowl(): Promise<Howl | null> {
    if (howl) return howl;
    loading = true;
    errored = false;
    try {
      const src = isDirectUrl(audioPath) ? audioPath : await resolveAudioUrl(audioPath);
      howl = new Howl({
        src: [src],
        html5: true,            // stream via range requests; don't buffer the whole file
        format: ['mp3'],
        onload: () => { duration = howl?.duration() ?? 0; },
        onplay: () => { isPlaying = true; raf = requestAnimationFrame(loop); },
        onpause: () => { isPlaying = false; cancelAnimationFrame(raf); },
        onstop: () => { isPlaying = false; cancelAnimationFrame(raf); },
        onend: () => { isPlaying = false; position = 0; cancelAnimationFrame(raf); },
        onloaderror: () => { errored = true; loading = false; },
        onplayerror: () => { errored = true; },
      });
    } catch {
      errored = true;
    } finally {
      loading = false;
    }
    return howl;
  }

  async function toggle() {
    const h = await ensureHowl();
    if (!h) return;
    if (h.playing()) h.pause();
    else h.play();
  }

  function seek(e: PointerEvent) {
    if (!howl || !duration) return;
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos = x * duration;
    howl.seek(pos);
    position = pos;
  }

  onDestroy(() => {
    cancelAnimationFrame(raf);
    try { howl?.unload(); } catch { /* ignore */ }
  });

  $: pct = duration > 0 ? (position / duration) * 100 : 0;
</script>

<div class="embed">
  <div class="art" aria-hidden="true">
    {#if cover}<img src={cover} alt="" />{:else}<div class="art-fallback"></div>{/if}
  </div>

  <div class="body">
    <div class="meta">
      <span class="title" title={title}>{title}</span>
      {#if catalogNumber}<span class="cat mono">{catalogNumber}</span>{/if}
    </div>

    <div class="transport">
      <button class="play" on:click={toggle} aria-label={isPlaying ? 'Pause' : 'Play'} disabled={loading}>
        {#if loading}
          <svg class="spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="42 18"/></svg>
        {:else if isPlaying}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        {/if}
      </button>

      <div class="track">
        <div
          class="seek"
          on:pointerdown={seek}
          role="slider"
          aria-label="Seek"
          tabindex="0"
          aria-valuemin="0"
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
        >
          <div class="seek-track"><div class="fill" style={`width:${pct}%`}></div></div>
        </div>
        <div class="time mono">
          <span>{fmt(position)}</span><span>{fmt(duration)}</span>
        </div>
      </div>
    </div>

    {#if errored}<span class="err mono">Couldn’t load this track.</span>{/if}
  </div>

  <a class="brand mono" href={releaseUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in LUFS catalog">LUFS ↗</a>
</div>

<style>
  .embed {
    display: flex; align-items: center; gap: 14px;
    box-sizing: border-box; width: 100%; height: 100%; min-height: 152px;
    padding: 16px; border-radius: 14px;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid rgba(251, 249, 226, 0.08);
    color: var(--color-text, #fbf9e2);
    font-family: var(--font-body, system-ui, sans-serif);
  }
  .art { flex: none; width: 96px; height: 96px; border-radius: 10px; overflow: hidden; background: var(--color-surface-2, #242424); }
  .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .art-fallback { width: 100%; height: 100%; background: linear-gradient(135deg, #242424, #1a1a1a); }

  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .title { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat { font-size: 0.72rem; color: var(--color-teal, #78BEBA); }

  .transport { display: flex; align-items: center; gap: 14px; }
  .play {
    flex: none; width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
    background: var(--color-teal, #78BEBA); display: flex; align-items: center; justify-content: center;
    transition: background 0.2s;
  }
  .play:hover:not(:disabled) { background: #63a7a5; }
  .play:disabled { opacity: 0.7; cursor: progress; }
  .play svg { width: 22px; height: 22px; fill: #111; }
  .play .spin { fill: none; stroke: #111; animation: sp 0.8s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }

  .track { flex: 1; min-width: 0; }
  .seek { height: 18px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  .seek-track { width: 100%; height: 4px; background: var(--color-surface-2, #242424); border-radius: 2px; }
  .fill { height: 100%; background: var(--color-gold, #E7B225); border-radius: 2px; }
  .time { display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.66rem; color: var(--color-text-muted, rgba(251,249,226,0.62)); }

  .err { font-size: 0.68rem; color: #e06b6b; }

  .brand { flex: none; align-self: flex-start; font-size: 0.64rem; letter-spacing: 0.12em; color: var(--color-text-muted, rgba(251,249,226,0.62)); text-decoration: none; }
  .brand:hover { color: var(--color-text, #fbf9e2); }

  .play:focus-visible, .seek:focus-visible, .brand:focus-visible { outline: 2px solid var(--color-teal, #78BEBA); outline-offset: 2px; }

  @media (max-width: 380px) {
    .art { width: 72px; height: 72px; }
    .title { font-size: 0.95rem; }
  }
</style>
