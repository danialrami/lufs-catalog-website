import { Howl, type HowlOptions, type Howl as HowlType } from 'howler';

/**
 * Create a Howl instance from an absolute audio path.
 * 
 * For local development: audioPath is a local URL like "/audio/xxx/yyy.mp3"
 * For production with R2: audioPath would be a signed URL from the Worker
 * 
 * This is the key abstraction that lets us swap between local and remote storage.
 */
export function createHowlFromUrl(audioPath: string, onEnd?: () => void): HowlType {
  const options: HowlOptions = {
    src: [audioPath],
    html5: true,
    preload: false,
    format: ['mp3'],
  };

  if (onEnd) {
    options.onend = onEnd;
  }

  return new Howl(options);
}

/**
 * Bind progress updates to a Howl instance.
 */
export function bindProgressLoop(howl: Howl, onTick: (seek: number) => void) {
  const tick = () => {
    if (howl.playing()) {
      onTick(howl.seek() as number);
      requestAnimationFrame(tick);
    }
  };
  
  howl.on('play', () => {
    requestAnimationFrame(tick);
  });
  
  howl.on('end', () => {
    howl.off('play', tick);
  });
}
