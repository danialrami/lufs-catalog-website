/**
 * Global audio manager - survives across page navigations
 * Uses localStorage for state persistence so audio can be restored after ViewTransition
 */

import { Howl } from 'howler';
import { resolveAudioUrl, isDirectUrl } from './resolveAudio';

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

// Monotonic token guarding against overlapping async loads. Each loadAudio() call claims
// the next token; an in-flight signed-URL resolve only builds its Howl if its token is
// still the latest. Without this, rapid or duplicate play triggers (e.g. 'play-track'
// listeners that accumulated across ViewTransitions navigations) each kicked off an async
// resolve while howlInstance was still null, so none unloaded the others — several
// orphaned Howls ended up playing at once (the ear-piercing overlap / feedback).
let loadToken = 0;

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

// --- Global event wiring (bound once; survives ViewTransitions) --------------------
// PlayerBar re-mounts on every Astro ViewTransition navigation. If it attached window
// listeners per-mount they would accumulate — one 'play-track' click then fires N times
// and (via the async load path) spawns N overlapping Howls. So we bind each global
// listener exactly ONCE here (this module persists across client-side navigations) and
// delegate to whatever handlers the most-recently-mounted PlayerBar registered.
type EventHandlerMap = {
  playTrack?: (e: Event) => void;
  pageLoad?: () => void;
  keydown?: (e: KeyboardEvent) => void;
};
const activeHandlers: EventHandlerMap = {};
let globalListenersWired = false;

export function setEventHandlers(handlers: EventHandlerMap) {
  Object.assign(activeHandlers, handlers);
  if (globalListenersWired || typeof window === 'undefined') return;
  window.addEventListener('play-track', (e) => activeHandlers.playTrack?.(e));
  document.addEventListener('astro:page-load', () => activeHandlers.pageLoad?.());
  window.addEventListener('keydown', (e) => activeHandlers.keydown?.(e as KeyboardEvent));
  globalListenersWired = true;
}

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

/**
 * Build the Howl from an already-resolved playable URL. `autoPlay` starts playback
 * on load so it works for both the synchronous (local) and async (R2) paths.
 */
function buildHowl(resolvedUrl: string, autoPlay: boolean) {
  // Never let two Howls coexist: tear down any current instance before creating a new one.
  if (howlInstance) {
    try { howlInstance.unload(); } catch { /* ignore */ }
    howlInstance = null;
  }
  const volume = getStoredState()?.volume ?? 0.8;
  try {
    howlInstance = new Howl({
      src: [resolvedUrl],
      html5: true,
      format: ['mp3'],
      volume,
      onload: () => {
        if (onLoadCallback && howlInstance) onLoadCallback(howlInstance.duration());
        if (autoPlay && howlInstance) howlInstance.play();
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
  } catch (e) {
    console.error('Failed to build audio:', e);
  }
}

/**
 * Load audio from a stored reference: a local "/audio/…" URL (or any http(s) URL),
 * or a private R2 key like "releases/…". Direct URLs build synchronously (unchanged
 * local behavior); R2 keys are first exchanged for a short-lived signed URL via the
 * stream Worker (see resolveAudio.ts).
 */
export function loadAudio(ref: string, autoPlay = true): boolean {
  if (howlInstance && currentAudioPath === ref && howlInstance.state() === 'loaded') {
    if (autoPlay) howlInstance.play();
    return true;
  }

  // Claim a token; any load already in flight becomes stale and must not build a Howl.
  const token = ++loadToken;

  if (howlInstance && howlInstance.playing()) {
    lastKnownPosition = howlInstance.seek() as number;
    saveState({ position: lastKnownPosition });
  }
  if (howlInstance) {
    howlInstance.unload();
    howlInstance = null;
  }

  currentAudioPath = ref;
  saveState({ audioPath: ref, position: 0, isPlaying: false });

  if (isDirectUrl(ref)) {
    if (token === loadToken) buildHowl(ref, autoPlay); // local / already-public URL — synchronous
  } else {
    resolveAudioUrl(ref) // private R2 key — sign via the stream Worker
      .then((url) => { if (token === loadToken) buildHowl(url, autoPlay); }) // drop if superseded
      .catch((e) => console.error('Failed to resolve audio URL:', e));
  }
  return true;
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
