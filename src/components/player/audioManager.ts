/**
 * Global audio manager — a TRUE singleton across Astro ViewTransitions.
 *
 * The player island re-initializes on navigation (Astro persists the DOM but re-hydrates
 * the Svelte component, and this module can be re-evaluated), so module-level `let` state
 * is NOT a reliable singleton. That's what let a track started on a previous page keep
 * playing as an orphan the new page's manager couldn't reach — two sounds at once, i.e.
 * the amplitude-overload / feedback bug. We therefore keep ALL mutable runtime state on
 * `window`, which genuinely persists for the life of the tab: exactly one Howl, one set of
 * global listeners, and one load token, shared by every (re)instantiation of this module.
 *
 * We intentionally do NOT use Howler.unload() (it also tears down the shared HTML5 audio
 * pool — the source of the "HTML5 Audio pool exhausted" warning). Instead we stop + unload
 * the single tracked Howl directly; because its reference lives on window, that reaches a
 * Howl created by any previous page too.
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

interface Runtime {
  howl: Howl | null;
  currentAudioPath: string | null;
  lastKnownPosition: number;
  positionInterval: ReturnType<typeof setInterval> | null;
  shouldAutoPlay: boolean;
  loadToken: number;
  listenersWired: boolean;
  handlers: {
    playTrack?: (e: Event) => void;
    pageLoad?: () => void;
    keydown?: (e: KeyboardEvent) => void;
  };
  cb: {
    play?: () => void;
    pause?: () => void;
    end?: () => void;
    load?: (duration: number) => void;
    seek?: (position: number) => void;
  };
}

// The one and only runtime, stashed on the global so every re-import/re-mount shares it.
function rt(): Runtime {
  const g = globalThis as any;
  if (!g.__lufsAudioRuntime) {
    g.__lufsAudioRuntime = {
      howl: null,
      currentAudioPath: null,
      lastKnownPosition: 0,
      positionInterval: null,
      shouldAutoPlay: false,
      loadToken: 0,
      listenersWired: false,
      handlers: {},
      cb: {},
    } as Runtime;
  }
  return g.__lufsAudioRuntime as Runtime;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch {
    // Storage unavailable
  }
}

// ---- position tracking ----
function startPositionTracking() {
  const r = rt();
  if (r.positionInterval) clearInterval(r.positionInterval);
  r.positionInterval = setInterval(() => {
    if (r.howl && r.howl.playing()) {
      r.lastKnownPosition = r.howl.seek() as number;
      saveState({ position: r.lastKnownPosition, isPlaying: true });
    }
  }, 500);
}

function stopPositionTracking() {
  const r = rt();
  if (r.positionInterval) {
    clearInterval(r.positionInterval);
    r.positionInterval = null;
  }
}

// ---- UI callbacks (the most recently mounted PlayerBar wins) ----
export function setOnPlay(cb: () => void) { rt().cb.play = cb; }
export function setOnPause(cb: () => void) { rt().cb.pause = cb; }
export function setOnEnd(cb: () => void) { rt().cb.end = cb; }
export function setOnLoad(cb: (duration: number) => void) { rt().cb.load = cb; }
export function setOnSeek(cb: (position: number) => void) { rt().cb.seek = cb; }

// ---- global event listeners, bound exactly once for the tab ----
// PlayerBar re-mounts on every navigation; binding here (guarded by a window-backed flag)
// means the listeners can never accumulate, and they always delegate to the active instance.
type EventHandlerMap = Runtime['handlers'];
export function setEventHandlers(handlers: EventHandlerMap) {
  const r = rt();
  Object.assign(r.handlers, handlers);
  if (r.listenersWired || typeof window === 'undefined') return;
  window.addEventListener('play-track', (e) => r.handlers.playTrack?.(e));
  document.addEventListener('astro:page-load', () => r.handlers.pageLoad?.());
  window.addEventListener('keydown', (e) => r.handlers.keydown?.(e as KeyboardEvent));
  r.listenersWired = true;
}

export function getLastKnownPosition(): number { return rt().lastKnownPosition; }

export function hasStoredState(): boolean {
  const state = getStoredState();
  return !!(state?.audioPath);
}

export function restoreFromStorage(): { audioPath: string; position: number; volume: number } | null {
  const state = getStoredState();
  if (!state?.audioPath) return null;
  const r = rt();
  r.currentAudioPath = state.audioPath;
  r.lastKnownPosition = state.position;
  r.shouldAutoPlay = state.isPlaying;
  return { audioPath: state.audioPath, position: state.position, volume: state.volume };
}

/**
 * Build the Howl from an already-resolved playable URL. Tears down the single tracked
 * instance first (reaching orphans from previous pages), then becomes the new one.
 */
function buildHowl(resolvedUrl: string, autoPlay: boolean) {
  const r = rt();
  if (r.howl) {
    try { r.howl.stop(); r.howl.unload(); } catch { /* ignore */ }
    r.howl = null;
  }
  const volume = getStoredState()?.volume ?? 0.8;
  try {
    const howl = new Howl({
      src: [resolvedUrl],
      html5: true,
      format: ['mp3'],
      volume,
      // Ignore callbacks from a Howl that has since been superseded by a newer load.
      onload: () => { if (rt().howl !== howl) return; r.cb.load?.(howl.duration()); if (autoPlay) howl.play(); },
      onplay: () => { if (rt().howl !== howl) return; startPositionTracking(); saveState({ isPlaying: true }); r.cb.play?.(); },
      onpause: () => {
        if (rt().howl !== howl) return;
        stopPositionTracking();
        r.lastKnownPosition = howl.seek() as number;
        saveState({ position: r.lastKnownPosition, isPlaying: false });
        r.cb.pause?.();
      },
      onstop: () => { if (rt().howl !== howl) return; stopPositionTracking(); saveState({ isPlaying: false }); r.cb.pause?.(); },
      onend: () => {
        if (rt().howl !== howl) return;
        stopPositionTracking();
        r.lastKnownPosition = 0;
        saveState({ position: 0, isPlaying: false });
        r.cb.end?.();
      },
      onseek: () => {
        if (rt().howl !== howl) return;
        r.lastKnownPosition = howl.seek() as number;
        saveState({ position: r.lastKnownPosition });
        r.cb.seek?.(r.lastKnownPosition);
      },
    });
    r.howl = howl;
  } catch (e) {
    console.error('Failed to build audio:', e);
  }
}

/**
 * Load audio from a stored reference: a local "/audio/…" URL (or any http(s) URL), or a
 * private R2 key like "releases/…". The current track is stopped IMMEDIATELY (before the
 * async signing round-trip) so audio never overlaps, even mid-navigation.
 */
export function loadAudio(ref: string, autoPlay = true): boolean {
  const r = rt();
  if (r.howl && r.currentAudioPath === ref && r.howl.state() === 'loaded') {
    if (autoPlay) r.howl.play();
    return true;
  }

  // Claim a token; any load already in flight becomes stale and must not build a Howl.
  const token = ++r.loadToken;

  // Stop the current track right now — don't wait for the (async) signed-URL resolve.
  if (r.howl) {
    try {
      if (r.howl.playing()) { r.lastKnownPosition = r.howl.seek() as number; saveState({ position: r.lastKnownPosition }); }
      r.howl.stop();
      r.howl.unload();
    } catch { /* ignore */ }
    r.howl = null;
  }

  r.currentAudioPath = ref;
  saveState({ audioPath: ref, position: 0, isPlaying: false });

  if (isDirectUrl(ref)) {
    if (token === r.loadToken) buildHowl(ref, autoPlay); // local / already-public URL — synchronous
  } else {
    resolveAudioUrl(ref) // private R2 key — sign via the stream Worker
      .then((url) => { if (token === r.loadToken) buildHowl(url, autoPlay); }) // drop if superseded
      .catch((e) => console.error('Failed to resolve audio URL:', e));
  }
  return true;
}

export function play() { const r = rt(); if (r.howl) r.howl.play(); }
export function pause() { const r = rt(); if (r.howl) r.howl.pause(); }
export function stop() { const r = rt(); if (r.howl) r.howl.stop(); }

export function seek(position: number) {
  const r = rt();
  if (r.howl) {
    r.howl.seek(position);
    r.lastKnownPosition = position;
    saveState({ position });
  }
}

export function setVolume(volume: number) {
  const r = rt();
  if (r.howl) r.howl.volume(volume);
  saveState({ volume });
}

export function isPlaying(): boolean { return rt().howl?.playing() ?? false; }
export function getPosition(): number { return (rt().howl?.seek() as number) ?? rt().lastKnownPosition; }
export function getDuration(): number { return rt().howl?.duration() ?? 0; }
export function getCurrentPath(): string | null { return rt().currentAudioPath; }
export function isLoaded(): boolean { return rt().howl?.state() === 'loaded'; }
export function shouldAutoPlayOnRestore(): boolean { return rt().shouldAutoPlay; }
