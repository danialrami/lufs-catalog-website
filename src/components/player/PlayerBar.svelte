<script lang="ts">
  import { onMount } from 'svelte';
  import { playerState, isPlaying, currentTrack, playNext, playTrack, togglePlay } from './playerStore';
  import type { Track } from './playerStore';
  import { createHowlFromUrl } from './useHowler';
  import type { Howl } from 'howler';

  let howl: Howl | null = null;
  let progressFill: HTMLElement;
  let timeCurrent: HTMLElement;
  let timeTotal: HTMLElement;
  let volumeFill: HTMLElement;

  // Subscribe to store
  let unsubPlayerState: (() => void) | undefined;
  let unsubIsPlaying: (() => void) | undefined;
  let unsubVolume: (() => void) | undefined;

  onMount(() => {
    // Listen for play-track events from the page
    const handlePlayTrack = (e: Event) => {
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
      };
      
      playTrack(track);
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('play-track', handlePlayTrack as EventListener);
    }

    // Subscribe to player state for track changes
    unsubPlayerState = playerState.subscribe((state) => {
      if (!state.currentTrack || !state.currentTrack.audioPath) return;
      
      const newAudioPath = state.currentTrack.audioPath;
      
      // Create new howl if track changed
      if (!howl || (howl.src().length > 0 && howl.src()[0] !== newAudioPath)) {
        if (howl) {
          howl.stop();
          howl.unload();
        }
        
        howl = createHowlFromUrl(newAudioPath, () => {
          playNext();
        });
        
        howl.on('load', () => {
          const dur = howl!.duration();
          if (dur) {
            playerState.set({
              ...playerState.get(),
              duration: dur,
            });
          }
          // Apply current volume
          howl!.volume(playerState.get().volume);
          // Start playing if isPlaying is true
          if (playerState.get().isPlaying) {
            howl!.play();
          }
        });
      }
      
      // Handle play/pause
      if (howl) {
        if (state.isPlaying && !howl.playing()) {
          howl.play();
        } else if (!state.isPlaying && howl.playing()) {
          howl.pause();
        }
      }
    });

    // Subscribe to isPlaying
    unsubIsPlaying = isPlaying.subscribe((val) => {
      if (howl) {
        if (val && !howl.playing()) {
          howl.play();
        } else if (!val && howl.playing()) {
          howl.pause();
        }
      }
    });

    // Subscribe to volume
    unsubVolume = playerState.subscribe((state) => {
      if (howl) {
        howl.volume(state.volume);
      }
      // Update volume UI
      if (volumeFill) {
        volumeFill.style.width = (state.volume * 100) + '%';
      }
    });

    // Start progress loop
    const tick = () => {
      if (howl && howl.playing()) {
        const pos = howl.seek() as number;
        const duration = howl.duration() || 0;
        
        // Update progress bar
        if (progressFill && duration > 0) {
          progressFill.style.width = (pos / duration) * 100 + '%';
        }
        
        // Update time displays
        if (timeCurrent) {
          timeCurrent.textContent = formatTime(pos);
        }
        if (timeTotal) {
          timeTotal.textContent = '/ ' + formatTime(duration);
        }
      }
      requestAnimationFrame(tick);
    };
    
    // Start the tick loop
    requestAnimationFrame(tick);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('play-track', handlePlayTrack as EventListener);
      }
      if (unsubPlayerState) unsubPlayerState();
      if (unsubIsPlaying) unsubIsPlaying();
      if (unsubVolume) unsubVolume();
      if (howl) {
        howl.stop();
        howl.unload();
      }
    };
  });

  function formatTime(seconds: number): string {
    if (!seconds || seconds === Infinity || isNaN(seconds)) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function handleSeek(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const duration = playerState.get().duration || 0;
    const newPos = x * duration;
    
    playerState.set({
      ...playerState.get(),
      position: newPos,
    });
    
    if (howl) {
      howl.seek(newPos);
    }
  }

  function handleVolume(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const vol = Math.max(0, Math.min(1, x));
    
    playerState.set({
      ...playerState.get(),
      volume: vol,
    });
  }

  function handleToggleMute() {
    const currentVol = playerState.get().volume;
    const newVol = currentVol === 0 ? 0.8 : 0;
    playerState.set({
      ...playerState.get(),
      volume: newVol,
    });
  }
</script>

<div class="player-bar">
  <div class="track-info">
    {#if $currentTrack}
      {#if $currentTrack.artwork?.main}
        <img 
          class="cover-art" 
          src={$currentTrack.artwork.main} 
          alt="Cover Art"
        />
      {/if}
      
      <div class="track-meta">
        <span class="track-title">{$currentTrack.displayTitle}</span>
        {#if $currentTrack.catalogNumber}
          <span class="track-artist">{$currentTrack.catalogNumber}</span>
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
      onclick={() => togglePlay()}
      aria-label={$currentTrack?.audioPath && $isPlaying ? 'Pause' : 'Play'}
    >
      {#if $currentTrack?.audioPath}
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
      onclick={() => playNext()}
      aria-label="Play next"
    >
      <svg class="icon" viewBox="0 0 24 24">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    </button>

    <div class="volume-container">
      <button 
        class="icon-btn"
        onclick={handleToggleMute}
        aria-label={$playerState.volume > 0 ? 'Mute' : 'Unmute'}
      >
        <svg class="icon" viewBox="0 0 24 24">
          {#if $playerState.volume === 0}
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.56v2.06c2.89 1.14 5 4.06 5 7.5zm-4 0c0-.94.2-1.82.54-2.64l-1.51-1.51C8.37 7.09 8 8.5 8 10c0 .46.04.92.1 1.36l-2.05 2.05c-.41-.36-.87-.66-1.36-.89L5.4 11.2c.03.2.05.41.05.63v1.79c0 .46.04.92.1 1.36l2.05-2.05c.49.36 1.01.64 1.56.82l1.95 1.95c-.21-2.24-1.77-4.08-3.75-4.67v2.18l2.29 2.29c.4-.35.75-.76 1.05-1.22l-2.3-2.3z" />
          {:else if $playerState.volume < 0.5}
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89 1.14 5 4.06 5 7.5s-2.11 6.36-5 7.5v2.06c4.01-1.18 7-5.05 7-9.56s-2.99-8.38-7-9.56z" />
          {:else}
            <path d="M3 9v6h4l5 5V4L7 9H3zm16.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM16 3.23v2.06c2.89 1.14 5 4.06 5 7.5s-2.11 6.36-5 7.5v2.06c4.01-1.18 7-5.05 7-9.56s-2.99-8.38-7-9.56z" />
          {/if}
        </svg>
      </button>

      <div 
        class="volume-bar"
        onclick={handleVolume}
        role="slider"
        aria-label="Volume"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round($playerState.volume * 100)}
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
