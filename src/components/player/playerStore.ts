import { atom, computed } from 'nanostores';

/**
 * Track interface - matches the content schema
 */
export interface Track {
  trackNumber: number;
  displayTitle: string;
  filename: string;
  catalogNumber: string;
  sha256: string;
  processedDate: string;
  saturation?: number;
  audioPath: string;
  renderStatsPath?: string;
  finalReport: string;
  duration: number;
  artwork?: {
    main?: string;
    identicon?: string;
    spectrogram?: string;
    canvasStatic?: string;
  };
}

/**
 * Player state
 */
interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  queue: Track[];
}

export const playerState = atom<PlayerState>({
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  queue: [],
});

export const isPlaying = computed(playerState, ($state) => $state.isPlaying);
export const currentTrack = computed(playerState, ($state) => $state.currentTrack);

// --- Actions ---

export function playTrack(track: Track) {
  const currentState = playerState.get();
  playerState.set({
    ...currentState,
    currentTrack: track,
    isPlaying: true,
    position: 0,
  });
}

export function playNext() {
  const { queue, currentTrack } = playerState.get();
  
  if (queue.length === 0) {
    // End of queue, loop to start or stop
    playerState.set({
      ...playerState.get(),
      isPlaying: false,
    });
    return;
  }
  
  const nextTrack = queue[0];
  playerState.set({
    ...playerState.get(),
    currentTrack: nextTrack,
    queue: queue.slice(1),
    isPlaying: true,
  });
}

export function togglePlay() {
  const { isPlaying } = playerState.get();
  playerState.set({
    ...playerState.get(),
    isPlaying: !isPlaying,
  });
}

export function seek(position: number) {
  playerState.set({
    ...playerState.get(),
    position,
  });
}

export function setVolume(volume: number) {
  playerState.set({
    ...playerState.get(),
    volume,
  });
}

export function playPrevious() {
  // Simple implementation - in production, keep a history
  console.log('playPrevious: not implemented');
}
