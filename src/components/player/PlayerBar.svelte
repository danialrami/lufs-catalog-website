<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Track } from './playerStore';
  import { persistedTrack, persistedVolume } from './playerStore';
  import * as audioManager from './audioManager';

  let currentTrack: Track | null = null;
  let isPlaying = false;
  let duration = 0;
  let position = 0;
  let volume = 0.8;

  // Bar (desktop) refs
  let progressFill: HTMLElement;
  let timeCurrent: HTMLElement;
  let timeTotal: HTMLElement;
  let volumeBar: HTMLElement;
  let volumeFill: HTMLElement;
  // Mobile collapsed-bar hairline
  let barFill: HTMLElement;
  // Now-playing sheet refs
  let sheetFill: HTMLElement;
  let sheetTimeCurrent: HTMLElement;
  let sheetTimeTotal: HTMLElement;
  let sheetVolumeFill: HTMLElement;
  let sheetCloseBtn: HTMLButtonElement;

  let animationId: number;
  let isDraggingVolume = false;
  let isScrubbing = false;
  let isRestoring = false;
  let sheetOpen = false;

  function formatTime(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function updateTimeDisplay() {
    const cur = formatTime(position);
    const tot = formatTime(duration);
    if (timeCurrent) timeCurrent.textContent = cur;
    if (timeTotal) timeTotal.textContent = '/' + tot;
    if (sheetTimeCurrent) sheetTimeCurrent.textContent = cur;
    if (sheetTimeTotal) sheetTimeTotal.textContent = tot;
  }

  function updateProgressUI() {
    const pct = duration > 0 ? (position / duration) * 100 : 0;
    const w = pct + '%';
    if (progressFill) progressFill.style.width = w;
    if (barFill) barFill.style.width = w;
    if (sheetFill) sheetFill.style.width = w;
  }

  function updateVolumeUI() {
    const w = volume * 100 + '%';
    if (volumeFill) volumeFill.style.width = w;
    if (sheetVolumeFill) sheetVolumeFill.style.width = w;
  }

  function startProgressLoop() {
    const tick = () => {
      if (audioManager.isPlaying()) {
        position = audioManager.getPosition();

        if (currentTrack) {
          persistedTrack.set({ audioPath: currentTrack.audioPath, position });
        }

        updateProgressUI();
        updateTimeDisplay();
        animationId = requestAnimationFrame(tick);
      }
    };

    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    tick();
  }

  function handlePlayTrack(e: Event) {
    const customEvent = e as CustomEvent;
    const { audioPath, trackTitle, coverArt, catalogNumber } = customEvent.detail;

    const track: Track = {
      trackNumber: 0,
      displayTitle: trackTitle || 'Unknown',
      filename: '',
      catalogNumber: catalogNumber || '',
      sha256: '',
      processedDate: new Date().toISOString(),
      audioPath: audioPath,
      finalReport: '',
      duration: 0,
      artwork: coverArt ? { main: coverArt } : {}
    };

    loadAndPlay(track);
  }

  function loadAndPlay(track: Track) {
    currentTrack = track;
    isPlaying = true;
    position = 0;
    duration = 0;

    persistedTrack.set({ audioPath: track.audioPath, position: 0 });

    // Persist volume first so the new Howl picks it up, then load with autoplay
    // (loadAudio plays on load — works for both local URLs and async-signed R2 keys).
    audioManager.setVolume(volume);
    audioManager.loadAudio(track.audioPath, true);
  }

  function restorePlayback() {
    // Only restore if audio is not already playing
    if (audioManager.isPlaying()) {
      return;
    }

    const restored = audioManager.restoreFromStorage();
    if (!restored) return;

    isRestoring = true;
    volume = restored.volume;
    updateVolumeUI();

    audioManager.setVolume(volume);

    const track: Track = {
      trackNumber: 0,
      displayTitle: restored.audioPath.split('/').pop() || 'Restored Track',
      filename: '',
      catalogNumber: '',
      sha256: '',
      processedDate: new Date().toISOString(),
      audioPath: restored.audioPath,
      finalReport: '',
      duration: 0,
      artwork: {}
    };

    currentTrack = track;
    audioManager.loadAudio(restored.audioPath, false);
    audioManager.setVolume(volume);
    audioManager.seek(restored.position);

    // Restore playing state
    setTimeout(() => {
      if (audioManager.shouldAutoPlayOnRestore()) {
        audioManager.play();
        isPlaying = true;
        startProgressLoop();
      }
      isRestoring = false;
    }, 100);
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      // A previous mount may have left the body scroll-locked (sheet open during a
      // ViewTransitions nav). Always start unlocked; the sheet re-opens via tap.
      document.body.style.overflow = '';
      sheetOpen = false;

      // Restore volume from persistent store
      volume = persistedVolume.get();
      updateVolumeUI();

      audioManager.setOnLoad((dur) => {
        duration = dur;
        updateProgressUI();
        updateTimeDisplay();
      });

      audioManager.setOnPlay(() => {
        isPlaying = true;
        startProgressLoop();
      });

      audioManager.setOnPause(() => {
        isPlaying = false;
      });

      audioManager.setOnEnd(() => {
        isPlaying = false;
        position = 0;
        persistedTrack.set(null);
        updateProgressUI();
        updateTimeDisplay();
      });

      audioManager.setOnSeek((pos) => {
        position = pos;
        if (currentTrack) {
          persistedTrack.set({ audioPath: currentTrack.audioPath, position: pos });
        }
      });

      restorePlayback();

      // Bind global listeners ONCE via the audioManager (deduped at module scope) and
      // point them at this instance's handlers. Astro ViewTransitions re-mount this
      // island on every navigation; binding per-mount used to accumulate listeners, so a
      // single play click fired multiple times and spawned overlapping Howls. Re-running
      // this each mount just re-points the single set of listeners at the latest instance.
      audioManager.setEventHandlers({
        playTrack: handlePlayTrack,
        pageLoad: restorePlayback,
        keydown: handleKeydown,
      });
    }

    updateVolumeUI();
  });

  onDestroy(() => {
    // Global listeners are owned by audioManager (bound once, delegating to the active
    // instance), so there's nothing to detach per-instance here.
    if (typeof document !== 'undefined') document.body.style.overflow = '';
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    // Only handle if focus is not in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    if (e.code === 'Escape' && sheetOpen) {
      e.preventDefault();
      closeSheet();
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setVolumeLevel(Math.max(0, volume - 0.1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setVolumeLevel(Math.min(1, volume + 0.1));
        break;
    }
  }

  function togglePlayPause() {
    if (audioManager.isLoaded()) {
      if (isPlaying) {
        audioManager.pause();
      } else {
        audioManager.play();
      }
    }
  }

  // ---- Now-playing sheet (mobile) ----
  function openSheet() {
    // The sheet is the mobile interaction surface; on desktop the inline controls are
    // visible, so tapping the track info does nothing there.
    if (!currentTrack) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches) return;
    sheetOpen = true;
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      updateProgressUI();
      updateTimeDisplay();
      updateVolumeUI();
      sheetCloseBtn?.focus();
    });
  }

  function closeSheet() {
    sheetOpen = false;
    if (typeof document !== 'undefined') document.body.style.overflow = '';
  }

  function onTrackInfoKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      openSheet();
    }
  }

  // ---- Seeking: Pointer Events so a single code path handles mouse AND touch. ----
  function seekFromClientX(clientX: number, bar: HTMLElement | null) {
    if (!duration || !bar) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newPos = x * duration;

    audioManager.seek(newPos);
    position = newPos;

    if (currentTrack) {
      persistedTrack.set({ audioPath: currentTrack.audioPath, position: newPos });
    }

    updateProgressUI();
    updateTimeDisplay();
  }

  function handleSeekPointerDown(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    isScrubbing = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    seekFromClientX(e.clientX, bar);
  }

  function handleSeekPointerMove(e: PointerEvent) {
    if (!isScrubbing) return;
    seekFromClientX(e.clientX, e.currentTarget as HTMLElement);
  }

  function handleSeekPointerUp(e: PointerEvent) {
    if (!isScrubbing) return;
    isScrubbing = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  // ---- Volume: also Pointer Events (mouse + touch). ----
  function volumeFromClientX(clientX: number, bar: HTMLElement | null) {
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setVolumeLevel(x);
  }

  function handleVolumePointerDown(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    isDraggingVolume = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    volumeFromClientX(e.clientX, bar);
  }

  function handleVolumePointerMove(e: PointerEvent) {
    if (!isDraggingVolume) return;
    volumeFromClientX(e.clientX, e.currentTarget as HTMLElement);
  }

  function handleVolumePointerUp(e: PointerEvent) {
    if (!isDraggingVolume) return;
    isDraggingVolume = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function setVolumeLevel(x: number) {
    volume = Math.max(0, Math.min(1, x));
    persistedVolume.set(volume);
    audioManager.setVolume(volume);
    updateVolumeUI();
  }

  function toggleMute() {
    volume = volume > 0 ? 0 : 0.8;
    persistedVolume.set(volume);
    audioManager.setVolume(volume);
    updateVolumeUI();
  }

  function restartTrack() {
    if (audioManager.isLoaded()) {
      audioManager.seek(0);
      audioManager.play();
    }
  }
</script>

<div class="player-bar">
  <div class="bar-progress" aria-hidden="true"><div class="bar-progress-fill" bind:this={barFill}></div></div>

  <div
    class="track-info"
    class:tappable={!!currentTrack}
    role="button"
    tabindex={currentTrack ? 0 : -1}
    aria-label={currentTrack ? 'Open now playing' : undefined}
    onclick={openSheet}
    onkeydown={onTrackInfoKey}
  >
    {#if currentTrack}
      {#if currentTrack.artwork?.main}
        <img
          class="cover-art"
          src={currentTrack.artwork.main}
          alt="Cover Art"
        />
      {:else}
        <div class="cover-art cover-fallback" aria-hidden="true"></div>
      {/if}

      <div class="track-meta">
        <span class="track-title">{currentTrack.displayTitle}</span>
        {#if currentTrack.catalogNumber}
          <span class="track-artist">{currentTrack.catalogNumber}</span>
        {/if}
      </div>
      <span class="bar-expand" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z" /></svg>
      </span>
    {:else}
      <div class="track-meta">
        <span class="track-title">No track selected</span>
      </div>
    {/if}
  </div>

  <div class="controls">
    <button
      class="play-btn"
      onclick={togglePlayPause}
      aria-label={currentTrack && isPlaying ? 'Pause' : 'Play'}
    >
      {#if currentTrack && isPlaying}
        <svg class="pause-icon" viewBox="0 0 24 24">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      {:else}
        <svg class="play-icon" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      {/if}
    </button>

    <div class="progress-container">
      <div
        class="progress-bar"
        onpointerdown={handleSeekPointerDown}
        onpointermove={handleSeekPointerMove}
        onpointerup={handleSeekPointerUp}
        onpointercancel={handleSeekPointerUp}
        role="slider"
        aria-label="Seek"
        tabindex="0"
        aria-valuemin="0"
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
      >
        <div class="progress-fill" bind:this={progressFill}></div>
      </div>

      <span class="time-display" bind:this={timeCurrent}>0:00</span>
      <span class="time-display" bind:this={timeTotal}>/ --</span>
    </div>
  </div>

  <div class="icons">
    <button
      class="icon-btn"
      onclick={restartTrack}
      aria-label="Restart track"
    >
      <svg class="icon" viewBox="0 0 24 24">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    </button>

    <div class="volume-container">
      <button
        class="icon-btn"
        onclick={toggleMute}
        aria-label={volume > 0 ? 'Mute' : 'Unmute'}
      >
        <svg class="icon" viewBox="0 0 24 24">
          {#if volume === 0}
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.56v2.06c2.89 1.14 5 4.06 5 7.5zm-4 0c0-.94.2-1.82.54-2.64l-1.51-1.51C8.37 7.09 8 8.5 8 10c0 .46.04.92.1 1.36l-2.05 2.05c-.41-.36-.87-.66-1.36-.89L5.4 11.2c.03.2.05.41.05.63v1.79c0 .46.04.92.1 1.36l2.05-2.05c.49.36 1.01.64 1.56.82l1.95 1.95c-.21-2.24-1.77-4.08-3.75-4.67v2.18l2.29 2.29c.4-.35.75-.76 1.05-1.22l-2.3-2.3zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
          {:else if volume < 0.5}
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89 1.14 5 4.06 5 7.5s-2.11 6.36-5 7.5v2.06c4.01-1.18 7-5.05 7-9.56s-2.99-8.38-7-9.56z" />
          {:else}
            <path d="M3 9v6h4l5 5V4L7 9H3zm16.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM16 3.23v2.06c2.89 1.14 5 4.06 5 7.5s-2.11 6.36-5 7.5v2.06c4.01-1.18 7-5.05 7-9.56s-2.99-8.38-7-9.56z" />
          {/if}
        </svg>
      </button>

      <div
        class="volume-bar"
        bind:this={volumeBar}
        onpointerdown={handleVolumePointerDown}
        onpointermove={handleVolumePointerMove}
        onpointerup={handleVolumePointerUp}
        onpointercancel={handleVolumePointerUp}
        role="slider"
        aria-label="Volume"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(volume * 100)}
        tabindex="0"
      >
        <div class="volume-fill" bind:this={volumeFill}></div>
      </div>
    </div>
  </div>
</div>

<!-- Now-playing sheet — the mobile "expanded" player. Hidden/inert on desktop. -->
<div class="now-sheet" class:open={sheetOpen} aria-hidden={!sheetOpen}>
  <div class="sheet-backdrop" onclick={closeSheet} role="presentation"></div>

  <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Now playing">
    <div class="sheet-top">
      <button class="sheet-close" bind:this={sheetCloseBtn} onclick={closeSheet} aria-label="Close now playing">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
      </button>
      <span class="sheet-label">Now Playing</span>
      <span class="sheet-spacer" aria-hidden="true"></span>
    </div>

    <div class="sheet-art">
      {#if currentTrack?.artwork?.main}
        <img src={currentTrack.artwork.main} alt="Cover art" />
      {:else}
        <div class="sheet-art-fallback" aria-hidden="true"></div>
      {/if}
    </div>

    <div class="sheet-meta">
      <span class="sheet-title">{currentTrack ? currentTrack.displayTitle : 'No track selected'}</span>
      {#if currentTrack?.catalogNumber}
        <span class="sheet-cat mono">{currentTrack.catalogNumber}</span>
      {/if}
    </div>

    <div class="sheet-seek-wrap">
      <div
        class="sheet-seek"
        onpointerdown={handleSeekPointerDown}
        onpointermove={handleSeekPointerMove}
        onpointerup={handleSeekPointerUp}
        onpointercancel={handleSeekPointerUp}
        role="slider"
        aria-label="Seek"
        tabindex="0"
        aria-valuemin="0"
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
      >
        <div class="sheet-seek-track"><div class="sheet-seek-fill" bind:this={sheetFill}><span class="sheet-knob"></span></div></div>
      </div>
      <div class="sheet-times mono">
        <span bind:this={sheetTimeCurrent}>0:00</span>
        <span bind:this={sheetTimeTotal}>0:00</span>
      </div>
    </div>

    <div class="sheet-transport">
      <button class="sheet-btn" onclick={restartTrack} aria-label="Restart track">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
      </button>
      <button class="sheet-play" onclick={togglePlayPause} aria-label={currentTrack && isPlaying ? 'Pause' : 'Play'}>
        {#if currentTrack && isPlaying}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        {/if}
      </button>
      <button class="sheet-btn" onclick={restartTrack} aria-label="Skip to start">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
    </div>

    <div class="sheet-volume">
      <button class="sheet-vol-btn" onclick={toggleMute} aria-label={volume > 0 ? 'Mute' : 'Unmute'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {#if volume === 0}
            <path d="M3.63 3.63a.996.996 0 0 0 0 1.41L7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.99 8.99 0 0 0 3.61-1.75l2.05 2.05a.996.996 0 1 0 1.41-1.41L5.05 3.63a.996.996 0 0 0-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53A8.95 8.95 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76z" />
          {:else}
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89 1.14 5 4.06 5 7.5s-2.11 6.36-5 7.5v2.06c4.01-1.18 7-5.05 7-9.56s-2.99-8.38-7-9.56z" />
          {/if}
        </svg>
      </button>
      <div
        class="sheet-vol-bar"
        onpointerdown={handleVolumePointerDown}
        onpointermove={handleVolumePointerMove}
        onpointerup={handleVolumePointerUp}
        onpointercancel={handleVolumePointerUp}
        role="slider"
        aria-label="Volume"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(volume * 100)}
        tabindex="0"
      >
        <div class="sheet-vol-track"><div class="sheet-vol-fill" bind:this={sheetVolumeFill}><span class="sheet-knob sheet-knob-teal"></span></div></div>
      </div>
    </div>
  </div>
</div>

<style>
  .player-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--player-height, 72px);
    background: #1a1a1a;
    border-top: 1px solid rgba(251, 249, 226, 0.08);
    display: flex;
    align-items: center;
    padding: 0 1rem;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    z-index: 1000;
    font-family: var(--font-body, system-ui, sans-serif);
    color: #fbf9e2;
  }

  /* Thin progress hairline pinned to the top edge of the bar — only visible on mobile,
     where the inline progress bar is hidden. */
  .bar-progress {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: #242424;
    display: none;
  }
  .bar-progress-fill { height: 100%; width: 0%; background: var(--color-gold, #E7B225); transition: width 0.1s linear; }

  .track-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 200px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    padding: 0;
  }
  .track-info.tappable { cursor: default; }
  .track-info:focus-visible { outline: 2px solid var(--color-teal, #78BEBA); outline-offset: 2px; border-radius: 4px; }

  .cover-art {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    background: #242424;
    flex-shrink: 0;
  }
  .cover-fallback { background: linear-gradient(135deg, #242424, #1a1a1a); }

  .track-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .track-title {
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-artist {
    font-size: 0.75rem;
    color: #E2E3D8;
    font-family: var(--font-mono, "SF Mono", monospace);
  }

  /* "Tap to expand" affordance — only meaningful on mobile, where the bar opens the sheet. */
  .bar-expand { display: none; margin-left: auto; color: var(--color-text-muted, rgba(251,249,226,0.62)); flex-shrink: 0; }
  .bar-expand svg { width: 22px; height: 22px; fill: currentColor; display: block; }

  .controls {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1.5rem;
  }

  .play-btn {
    background: #78BEBA;
    border: none;
    border-radius: 50%;
    width: 48px;
    height: 48px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .play-btn:hover { background: #63a7a5; }

  .pause-icon,
  .play-icon {
    width: 24px;
    height: 24px;
    fill: #111111;
  }

  .progress-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 300px;
    flex-shrink: 0;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: #242424;
    border-radius: 2px;
    cursor: pointer;
    position: relative;
    touch-action: none;
  }

  .progress-fill {
    height: 100%;
    background: #E7B225;
    border-radius: 2px;
    width: 0%;
    transition: width 0.1s linear;
  }

  .time-display {
    font-family: var(--font-mono, "SF Mono", ui-monospace, monospace);
    font-size: 0.75rem;
    color: #E2E3D8;
    min-width: 4.5rem;
    text-align: right;
  }

  .volume-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 120px;
    flex-shrink: 0;
  }

  .volume-bar {
    flex: 1;
    height: 4px;
    background: #242424;
    border-radius: 2px;
    cursor: pointer;
    touch-action: none;
  }

  .volume-fill {
    height: 100%;
    background: #78BEBA;
    border-radius: 2px;
    width: 80%;
  }

  .icons {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #E2E3D8;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover { color: #fff; }

  .icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  /* ============================ Now-playing sheet ============================ */
  .now-sheet {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    pointer-events: none;
    visibility: hidden;
  }
  .now-sheet.open { visibility: visible; pointer-events: auto; }

  .sheet-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .now-sheet.open .sheet-backdrop { opacity: 1; }

  .sheet-panel {
    position: relative;
    height: 100%;
    width: 100%;
    background: var(--color-bg, #111);
    color: var(--color-text, #fbf9e2);
    display: flex;
    flex-direction: column;
    padding: calc(env(safe-area-inset-top, 0px) + 1rem) clamp(20px, 7vw, 40px) calc(env(safe-area-inset-bottom, 0px) + 1.5rem);
    overflow-y: auto;
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .now-sheet.open .sheet-panel { transform: translateY(0); }

  .sheet-top { display: flex; align-items: center; gap: 0.5rem; }
  .sheet-close {
    width: 44px; height: 44px; flex-shrink: 0;
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted, rgba(251,249,226,0.62));
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
  }
  .sheet-close svg { width: 26px; height: 26px; fill: currentColor; }
  .sheet-close:hover { color: var(--color-text, #fbf9e2); }
  .sheet-label {
    flex: 1; text-align: center;
    font-family: var(--font-mono, monospace); text-transform: uppercase;
    letter-spacing: 0.18em; font-size: 0.7rem; color: var(--color-text-muted, rgba(251,249,226,0.62));
  }
  .sheet-spacer { width: 44px; flex-shrink: 0; }

  .sheet-art {
    width: min(74vw, 360px);
    aspect-ratio: 1 / 1;
    margin: clamp(1.25rem, 5vh, 2.5rem) auto clamp(1.5rem, 5vh, 2.5rem);
    border-radius: var(--radius-lg, 20px);
    overflow: hidden;
    background: var(--color-surface-2, #242424);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    flex-shrink: 0;
  }
  .sheet-art img { width: 100%; height: 100%; object-fit: cover; }
  .sheet-art-fallback { width: 100%; height: 100%; background: linear-gradient(135deg, var(--color-surface-2, #242424), var(--color-surface, #1a1a1a)); }

  .sheet-meta { text-align: center; display: flex; flex-direction: column; gap: 0.4rem; }
  .sheet-title {
    font-family: var(--font-display, system-ui, sans-serif);
    font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
    font-size: clamp(1.5rem, 6vw, 2rem);
  }
  .sheet-cat { font-size: 0.8rem; color: var(--color-teal, #78BEBA); }

  .sheet-seek-wrap { margin-top: clamp(1.5rem, 5vh, 2.5rem); }
  .sheet-seek {
    height: 44px; display: flex; align-items: center; cursor: pointer; touch-action: none;
  }
  .sheet-seek-track { width: 100%; height: 6px; background: var(--color-surface-2, #242424); border-radius: 3px; position: relative; }
  .sheet-seek-fill { height: 100%; width: 0%; background: var(--color-gold, #E7B225); border-radius: 3px; transition: width 0.1s linear; position: relative; }
  /* Draggable thumb sits at the leading edge of the fill so scrubbing is obviously grabbable on touch. */
  .sheet-knob {
    position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
    width: 16px; height: 16px; border-radius: 50%; background: var(--color-gold, #E7B225);
    box-shadow: 0 0 0 5px rgba(231, 178, 37, 0.16); pointer-events: none;
  }
  .sheet-knob-teal { background: var(--color-teal, #78BEBA); box-shadow: 0 0 0 5px rgba(120, 190, 186, 0.16); }
  .sheet-times {
    display: flex; justify-content: space-between; margin-top: 0.25rem;
    font-size: 0.72rem; color: var(--color-text-muted, rgba(251,249,226,0.62));
  }

  .sheet-transport {
    display: flex; align-items: center; justify-content: center;
    gap: clamp(1.5rem, 9vw, 2.75rem);
    margin: clamp(1.5rem, 5vh, 2.5rem) 0;
  }
  .sheet-btn {
    width: 52px; height: 52px; background: none; border: none; cursor: pointer;
    color: var(--color-text-muted, rgba(251,249,226,0.62));
    display: flex; align-items: center; justify-content: center; border-radius: 50%;
  }
  .sheet-btn svg { width: 26px; height: 26px; fill: currentColor; }
  .sheet-btn:hover { color: var(--color-text, #fbf9e2); }
  .sheet-play {
    width: 76px; height: 76px; border-radius: 50%; background: var(--color-teal, #78BEBA);
    border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.2s; flex-shrink: 0;
  }
  .sheet-play:hover { background: #63a7a5; }
  .sheet-play svg { width: 34px; height: 34px; fill: #111; }

  .sheet-volume {
    display: flex; align-items: center; gap: 0.85rem;
    width: 100%; max-width: 340px; margin: 0 auto;
  }
  .sheet-vol-btn {
    width: 44px; height: 44px; flex-shrink: 0; background: none; border: none; cursor: pointer;
    color: var(--color-text-muted, rgba(251,249,226,0.62));
    display: flex; align-items: center; justify-content: center;
  }
  .sheet-vol-btn svg { width: 22px; height: 22px; fill: currentColor; }
  .sheet-vol-bar { flex: 1; height: 44px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  .sheet-vol-track { width: 100%; height: 6px; background: var(--color-surface-2, #242424); border-radius: 3px; position: relative; }
  .sheet-vol-fill { height: 100%; width: 80%; background: var(--color-teal, #78BEBA); border-radius: 3px; position: relative; }

  .sheet-seek:focus-visible,
  .sheet-vol-bar:focus-visible,
  .sheet-close:focus-visible,
  .sheet-play:focus-visible,
  .sheet-btn:focus-visible,
  .sheet-vol-btn:focus-visible {
    outline: 2px solid var(--color-teal, #78BEBA);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet-panel, .sheet-backdrop,
    .progress-fill, .bar-progress-fill, .sheet-seek-fill { transition: none; }
  }

  /* ============================ Mobile bar ============================ */
  /* The fixed track/progress/volume widths (~840px) overflow narrow screens. On phones the
     bar collapses to artwork + title + play, with a hairline progress indicator; the full
     transport lives in the tap-to-open now-playing sheet. */
  @media (max-width: 760px) {
    .player-bar { height: var(--player-height, 58px); padding: 0 0.6rem; gap: 0.5rem; }
    .bar-progress { display: block; }
    .track-info { min-width: 0; flex: 1 1 auto; gap: 0.6rem; }
    .track-info.tappable { cursor: pointer; }
    .bar-expand { display: inline-flex; }
    .cover-art { width: 40px; height: 40px; }
    .controls { flex: 0 0 auto; gap: 0; }
    .play-btn { width: 44px; height: 44px; }
    .progress-container { display: none; }
    .time-display { display: none; }
    .icons { display: none; }
  }
</style>
