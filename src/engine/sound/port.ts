/** The far calls the game makes to its sound driver (see re/notes/90-sound.md), as the port sees them. */
export interface SoundPort {
  /** ah=4 / ah=9: the song a screen asks for, and which one is playing. */
  setSong(song: number): void;
  songPlaying(song: number): boolean;
  /** ah=5 and ah=8: queue a sound effect on the effects queue, or on the second one. */
  play(sound: number, music?: boolean): void;
  /** ah=0a: is that sound already on a channel? */
  isPlaying(sound: number): boolean;
  /** ah=6 / ah=7: stop everything, or just the song's own tracks. */
  stopAll(): void;
  stopVoices(): void;
  /**
   * fn 7b46: the engine note of one car. The game writes the pitch straight into the looping sequence the
   * driver keeps for that car and starts it if it is not already running.
   */
  engine(car: number, pitch: number, running: boolean): void;
}
