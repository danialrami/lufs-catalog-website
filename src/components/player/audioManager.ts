/**
 * Global audio manager - survives across page navigations
 * This module creates a singleton Howl instance that isn't tied to component lifecycle
 */

import { Howl } from 'howler';

let howlInstance: Howl | null = null;
let currentAudioPath: string | null = null;

// Callbacks for UI updates
let onPlayCallback: (() => void) | null = null;
let onPauseCallback: (() => void) | null = null;
let onEndCallback: (() => void) | null = null;
let onLoadCallback: ((duration: number) => void) | null = null;
let onSeekCallback: ((position: number) => void) | null = null;

export function setOnPlay(cb: () => void) { onPlayCallback = cb; }
export function setOnPause(cb: () => void) { onPauseCallback = cb; }
export function setOnEnd(cb: () => void) { onEndCallback = cb; }
export function setOnLoad(cb: (duration: number) => void) { onLoadCallback = cb; }
export function setOnSeek(cb: (position: number) => void) { onSeekCallback = cb; }

export function loadAudio(audioPath: string): boolean {
  // If same path and already loaded, don't reload
  if (howlInstance && currentAudioPath === audioPath && howlInstance.state() === 'loaded') {
    return true;
  }

  // Unload existing
  if (howlInstance) {
    howlInstance.unload();
    howlInstance = null;
  }

  currentAudioPath = audioPath;

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
        if (onPlayCallback) onPlayCallback();
      },
      onpause: () => {
        if (onPauseCallback) onPauseCallback();
      },
      onstop: () => {
        if (onPauseCallback) onPauseCallback();
      },
      onend: () => {
        if (onEndCallback) onEndCallback();
      },
      onseek: () => {
        if (onSeekCallback && howlInstance) {
          onSeekCallback(howlInstance.seek() as number);
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
  }
}

export function setVolume(volume: number) {
  if (howlInstance) {
    howlInstance.volume(volume);
  }
}

export function isPlaying(): boolean {
  return howlInstance?.playing() ?? false;
}

export function getPosition(): number {
  return (howlInstance?.seek() as number) ?? 0;
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
