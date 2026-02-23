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
  
  let progressFill: HTMLElement;
  let timeCurrent: HTMLElement;
  let timeTotal: HTMLElement;
  let volumeBar: HTMLElement;
  let volumeFill: HTMLElement;
  let animationId: number;
  let isDraggingVolume = false;
  let isRestoring = false;

  function updateTimeDisplay() {
    if (timeCurrent) {
      timeCurrent.textContent = formatTime(position);
    }
    if (timeTotal) {
      timeTotal.textContent = '/' + formatTime(duration);
    }
  }

  function formatTime(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function startProgressLoop() {
    const tick = () => {
      if (audioManager.isPlaying()) {
        position = audioManager.getPosition();
        
        if (currentTrack) {
          persistedTrack.set({ audioPath: currentTrack.audioPath, position });
        }
        
        if (progressFill && duration > 0) {
          progressFill.style.width = (position / duration * 100) + '%';
        }
        
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
    const { audioPath, trackTitle } = customEvent.detail;
    
    const track: Track = {
      trackNumber: 0,
      displayTitle: trackTitle || 'Unknown',
      filename: '',
      catalogNumber: '',
      sha256: '',
      processedDate: new Date().toISOString(),
      audioPath: audioPath,
      finalReport: '',
      duration: 0,
      artwork: {}
    };
    
    loadAndPlay(track);
  }

  function loadAndPlay(track: Track) {
    currentTrack = track;
    isPlaying = true;
    position = 0;
    duration = 0;
    
    persistedTrack.set({ audioPath: track.audioPath, position: 0 });
    
    const loaded = audioManager.loadAudio(track.audioPath);
    if (loaded) {
      audioManager.setVolume(volume);
      audioManager.play();
    }
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

    if (volumeFill) {
      volumeFill.style.width = (volume * 100) + '%';
    }

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
      // Clean up any existing listeners first (important for persisted components)
      document.removeEventListener('astro:page-load', restorePlayback);
      window.removeEventListener('play-track', handlePlayTrack as EventListener);
      
      // Restore volume from persistent store
      volume = persistedVolume.get();
      if (volumeFill) {
        volumeFill.style.width = (volume * 100) + '%';
      }
      
      audioManager.setOnLoad((dur) => {
        duration = dur;
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
        if (progressFill) progressFill.style.width = '0%';
        updateTimeDisplay();
      });
      
      audioManager.setOnSeek((pos) => {
        position = pos;
        if (currentTrack) {
          persistedTrack.set({ audioPath: currentTrack.audioPath, position: pos });
        }
      });
      
      restorePlayback();
      
      document.addEventListener('astro:page-load', restorePlayback);
      window.addEventListener('play-track', handlePlayTrack as EventListener);
      window.addEventListener('keydown', handleKeydown);
    }
    
    if (volumeFill) {
      volumeFill.style.width = (volume * 100) + '%';
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      document.removeEventListener('astro:page-load', restorePlayback);
      window.removeEventListener('play-track', handlePlayTrack as EventListener);
      window.removeEventListener('keydown', handleKeydown);
    }
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

  function handleSeek(e: MouseEvent) {
    if (!duration) return;
    
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const newPos = x * duration;
    
    audioManager.seek(newPos);
    position = newPos;
    
    if (currentTrack) {
      persistedTrack.set({ audioPath: currentTrack.audioPath, position: newPos });
    }
    
    if (progressFill && duration > 0) {
      progressFill.style.width = (position / duration * 100) + '%';
    }
  }

  function handleVolumeMouseDown(e: MouseEvent) {
    isDraggingVolume = true;
    updateVolumeFromEvent(e, volumeBar);
    
    window.addEventListener('mousemove', handleVolumeMouseMove);
    window.addEventListener('mouseup', handleVolumeMouseUp);
  }

  function handleVolumeMouseMove(e: MouseEvent) {
    if (!isDraggingVolume) return;
    updateVolumeFromEvent(e, volumeBar);
  }

  function handleVolumeMouseUp() {
    isDraggingVolume = false;
    window.removeEventListener('mousemove', handleVolumeMouseMove);
    window.removeEventListener('mouseup', handleVolumeMouseUp);
  }

  function handleVolumeClick(e: MouseEvent) {
    updateVolumeFromEvent(e, volumeBar);
  }

  function updateVolumeFromEvent(e: MouseEvent, bar: HTMLElement | undefined) {
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setVolumeLevel(x);
  }

  function setVolumeLevel(x: number) {
    volume = Math.max(0, Math.min(1, x));
    persistedVolume.set(volume);
    audioManager.setVolume(volume);
    
    if (volumeFill) {
      volumeFill.style.width = (volume * 100) + '%';
    }
  }

  function toggleMute() {
    if (volume > 0) {
      volume = 0;
    } else {
      volume = 0.8;
    }
    
    persistedVolume.set(volume);
    audioManager.setVolume(volume);
    
    if (volumeFill) {
      volumeFill.style.width = (volume * 100) + '%';
    }
  }

  function playNext() {
    if (audioManager.isLoaded()) {
      audioManager.seek(0);
      audioManager.play();
    }
  }
</script>

<div class="player-bar">
  <div class="track-info">
    {#if currentTrack}
      {#if currentTrack.artwork?.main}
        <img 
          class="cover-art" 
          src={currentTrack.artwork.main} 
          alt="Cover Art"
        />
      {/if}
      
      <div class="track-meta">
        <span class="track-title">{currentTrack.displayTitle}</span>
        {#if currentTrack.catalogNumber}
          <span class="track-artist">{currentTrack.catalogNumber}</span>
        {/if}
      </div>
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
        onclick={handleSeek}
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
      onclick={playNext}
      aria-label="Play next"
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
        onmousedown={handleVolumeMouseDown}
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

<style>
  .player-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 72px;
    background: #1a1a1a;
    border-top: 1px solid rgba(251, 249, 226, 0.08);
    display: flex;
    align-items: center;
    padding: 0 1rem;
    z-index: 1000;
    font-family: system-ui, sans-serif;
    color: #fbf9e2;
  }

  .track-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 200px;
  }

  .cover-art {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    background: #242424;
  }

  .track-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .track-title {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .track-artist {
    font-size: 0.75rem;
    color: #E2E3D8;
    font-family: "SF Mono", monospace;
  }

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

  .play-btn:hover {
    background: #63a7a5;
  }

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
  }

  .progress-fill {
    height: 100%;
    background: #E7B225;
    border-radius: 2px;
    width: 0%;
    transition: width 0.1s linear;
  }

  .time-display {
    font-family: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
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

  .icon-btn:hover {
    color: #fff;
  }

  .icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
</style>
