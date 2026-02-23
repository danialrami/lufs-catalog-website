/**
 * Global audio manager - survives across page navigations
 * Uses localStorage for state persistence so audio can be restored after ViewTransition
 */

import { Howl } from 'howler';

const STORAGE_KEY = 'lufs-audio-state';

interface AudioState {
  audioPath: string | null;
  position: number;
  volume: number;
  isPlaying: boolean;
}

function getStoredState(): AudioState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveState(state: Partial<AudioState>) {
  if (typeof window === 'undefined') return;
  try {
    const current = getStoredState() || { audioPath: null, position: 0, volume: 0.8, isPlaying: false };
    const updated = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage unavailable
  }
}

let howlInstance: Howl | null = null;
let currentAudioPath: string | null = null;
let lastKnownPosition = 0;
let positionInterval: ReturnType<typeof setInterval> | null = null;
let shouldAutoPlay = false;

// Callbacks for UI updates
let onPlayCallback: (() => void) | null = null;
let onPauseCallback: (() => void) | null = null;
let onEndCallback: (() => void) | null = null;
let onLoadCallback: ((duration: number) => void) | null = null;
let onSeekCallback: ((position: number) => void) | null = null;

// Track position periodically
function startPositionTracking() {
  if (positionInterval) clearInterval(positionInterval);
  positionInterval = setInterval(() => {
    if (howlInstance && howlInstance.playing()) {
      lastKnownPosition = howlInstance.seek() as number;
      saveState({ position: lastKnownPosition, isPlaying: true });
    }
  }, 500);
}

function stopPositionTracking() {
  if (positionInterval) {
    clearInterval(positionInterval);
    positionInterval = null;
  }
}

export function setOnPlay(cb: () => void) { onPlayCallback = cb; }
export function setOnPause(cb: () => void) { onPauseCallback = cb; }
export function setOnEnd(cb: () => void) { onEndCallback = cb; }
export function setOnLoad(cb: (duration: number) => void) { onLoadCallback = cb; }
export function setOnSeek(cb: (position: number) => void) { onSeekCallback = cb; }

export function getLastKnownPosition(): number {
  return lastKnownPosition;
}

export function hasStoredState(): boolean {
  const state = getStoredState();
  return !!(state?.audioPath);
}

export function restoreFromStorage(): { audioPath: string; position: number; volume: number } | null {
  const state = getStoredState();
  if (!state?.audioPath) return null;
  
  currentAudioPath = state.audioPath;
  lastKnownPosition = state.position;
  shouldAutoPlay = state.isPlaying;
  
  return {
    audioPath: state.audioPath,
    position: state.position,
    volume: state.volume,
  };
}

export function loadAudio(audioPath: string, autoPlay = true): boolean {
  if (howlInstance && currentAudioPath === audioPath && howlInstance.state() === 'loaded') {
    return true;
  }

  if (howlInstance && howlInstance.playing()) {
    lastKnownPosition = howlInstance.seek() as number;
    saveState({ position: lastKnownPosition });
  }

  if (howlInstance) {
    howlInstance.unload();
    howlInstance = null;
  }

  currentAudioPath = audioPath;
  saveState({ audioPath, position: 0, isPlaying: false });

  try {
    howlInstance = new Howl({
      src: [audioPath],
      html5: true,
      format: ['mp3'],
      volume: 0.8,
      onload: () => {
        if (onLoadCallback && howlInstance) {
          onLoadCallback(howlInstance.duration());
        }
      },
      onplay: () => {
        startPositionTracking();
        saveState({ isPlaying: true });
        if (onPlayCallback) onPlayCallback();
      },
      onpause: () => {
        stopPositionTracking();
        if (howlInstance) {
          lastKnownPosition = howlInstance.seek() as number;
          saveState({ position: lastKnownPosition, isPlaying: false });
        }
        if (onPauseCallback) onPauseCallback();
      },
      onstop: () => {
        stopPositionTracking();
        saveState({ isPlaying: false });
        if (onPauseCallback) onPauseCallback();
      },
      onend: () => {
        stopPositionTracking();
        lastKnownPosition = 0;
        saveState({ position: 0, isPlaying: false });
        if (onEndCallback) onEndCallback();
      },
      onseek: () => {
        if (howlInstance) {
          lastKnownPosition = howlInstance.seek() as number;
          saveState({ position: lastKnownPosition });
          if (onSeekCallback) onSeekCallback(lastKnownPosition);
        }
      },
    });
    return true;
  } catch (e) {
    console.error('Failed to load audio:', e);
    return false;
  }
}

export function play() {
  if (howlInstance) {
    howlInstance.play();
  }
}

export function pause() {
  if (howlInstance) {
    howlInstance.pause();
  }
}

export function stop() {
  if (howlInstance) {
    howlInstance.stop();
  }
}

export function seek(position: number) {
  if (howlInstance) {
    howlInstance.seek(position);
    lastKnownPosition = position;
    saveState({ position });
  }
}

export function setVolume(volume: number) {
  if (howlInstance) {
    howlInstance.volume(volume);
  }
  saveState({ volume });
}

export function isPlaying(): boolean {
  return howlInstance?.playing() ?? false;
}

export function getPosition(): number {
  return (howlInstance?.seek() as number) ?? lastKnownPosition;
}

export function getDuration(): number {
  return howlInstance?.duration() ?? 0;
}

export function getCurrentPath(): string | null {
  return currentAudioPath;
}

export function isLoaded(): boolean {
  return howlInstance?.state() === 'loaded';
}

export function shouldAutoPlayOnRestore(): boolean {
  return shouldAutoPlay;
}
