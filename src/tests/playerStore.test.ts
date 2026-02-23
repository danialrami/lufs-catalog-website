import { describe, it, expect, beforeEach } from 'vitest';
import { playerState, isPlaying, currentTrack, playTrack, playNext, togglePlay, seek, setVolume } from '../components/player/playerStore';
import type { Track } from '../components/player/playerStore';

describe('playerStore', () => {
  beforeEach(() => {
    playerState.set({
      currentTrack: null,
      isPlaying: false,
      position: 0,
      duration: 0,
      volume: 0.8,
      queue: [],
    });
  });

  describe('initial state', () => {
    it('should have null currentTrack', () => {
      expect(playerState.get().currentTrack).toBeNull();
    });

    it('should not be playing', () => {
      expect(isPlaying.get()).toBe(false);
    });

    it('should have default volume of 0.8', () => {
      expect(playerState.get().volume).toBe(0.8);
    });
  });

  describe('playTrack', () => {
    it('should set currentTrack and start playing', () => {
      const track: Track = {
        trackNumber: 1,
        displayTitle: 'Test Track',
        filename: 'test-track.mp3',
        catalogNumber: 'lufs-12345678',
        sha256: 'a'.repeat(64),
        processedDate: '2026-02-23T00:00:00Z',
        audioPath: '/audio/test-track.mp3',
        finalReport: '/reports/test-track/final_report.html',
        duration: 180,
      };

      playTrack(track);

      expect(playerState.get().currentTrack).toEqual(track);
      expect(playerState.get().isPlaying).toBe(true);
      expect(playerState.get().position).toBe(0);
    });
  });

  describe('togglePlay', () => {
    it('should toggle isPlaying from false to true', () => {
      togglePlay();
      expect(playerState.get().isPlaying).toBe(true);
    });

    it('should toggle isPlaying from true to false', () => {
      playerState.set({ ...playerState.get(), isPlaying: true });
      togglePlay();
      expect(playerState.get().isPlaying).toBe(false);
    });
  });

  describe('seek', () => {
    it('should update position', () => {
      seek(60);
      expect(playerState.get().position).toBe(60);
    });
  });

  describe('setVolume', () => {
    it('should update volume', () => {
      setVolume(0.5);
      expect(playerState.get().volume).toBe(0.5);
    });

    it('should clamp volume to valid range', () => {
      setVolume(1.5);
      expect(playerState.get().volume).toBe(1.5);
    });
  });

  describe('playNext', () => {
    it('should do nothing when queue is empty', () => {
      playTrack({
        trackNumber: 1,
        displayTitle: 'Track 1',
        filename: 'track1.mp3',
        catalogNumber: 'lufs-11111111',
        sha256: 'a'.repeat(64),
        processedDate: '2026-02-23T00:00:00Z',
        audioPath: '/audio/track1.mp3',
        finalReport: '',
        duration: 0,
      });

      playNext();

      expect(playerState.get().isPlaying).toBe(false);
    });

    it('should play next track in queue', () => {
      const track1: Track = {
        trackNumber: 1,
        displayTitle: 'Track 1',
        filename: 'track1.mp3',
        catalogNumber: 'lufs-11111111',
        sha256: 'a'.repeat(64),
        processedDate: '2026-02-23T00:00:00Z',
        audioPath: '/audio/track1.mp3',
        finalReport: '',
        duration: 0,
      };

      const track2: Track = {
        trackNumber: 2,
        displayTitle: 'Track 2',
        filename: 'track2.mp3',
        catalogNumber: 'lufs-22222222',
        sha256: 'b'.repeat(64),
        processedDate: '2026-02-23T00:00:00Z',
        audioPath: '/audio/track2.mp3',
        finalReport: '',
        duration: 0,
      };

      playerState.set({
        ...playerState.get(),
        currentTrack: track1,
        queue: [track2],
      });

      playNext();

      expect(playerState.get().currentTrack).toEqual(track2);
      expect(playerState.get().queue).toHaveLength(0);
      expect(playerState.get().isPlaying).toBe(true);
    });
  });
});
