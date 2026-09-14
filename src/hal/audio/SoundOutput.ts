/**
 * Web Audio output for the sound driver: renders the OPL2 at its own 49716 Hz, resamples to whatever the
 * browser's audio clock runs at, and schedules short buffers a little ahead of the playhead. The driver's
 * tick (the game's int 8) is counted in audio samples, so the music keeps time even when a frame is late.
 */
import { SoundDriver } from '../../engine/sound/driver';
import type { SoundPort } from '../../engine/sound/port';
import { OPL2, OPL_RATE } from '../../engine/sound/opl2';

const TICK_RATE = 70.086;                // the game's timer, and the driver's
const CHUNK = 0.05;                      // seconds per scheduled buffer
const AHEAD = 0.2;                       // how far ahead of the playhead to keep the queue

export class SoundOutput implements SoundPort {
  readonly opl = new OPL2();
  readonly driver: SoundDriver;
  private ctx?: AudioContext;
  private gain?: GainNode;
  private next = 0;                      // when the next buffer should start
  private position = 0;                  // fractional position between two OPL samples
  private previous = 0; private current = 0;
  private tickCarry = 0;

  constructor(image: Uint8Array) {
    this.driver = new SoundDriver(image, this.opl);
    this.driver.init();
  }

  /** Browsers only allow this from a click or a key press. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.7;
    this.gain.connect(this.ctx.destination);
    this.next = this.ctx.currentTime + 0.05;
  }

  get running(): boolean { return this.ctx !== undefined; }

  /** Call once per animation frame: tops the queue up. */
  pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02;   // the tab was away
    while (this.next < ctx.currentTime + AHEAD) {
      const frames = Math.round(CHUNK * ctx.sampleRate);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const out = buffer.getChannelData(0);
      const step = OPL_RATE / ctx.sampleRate;
      for (let i = 0; i < frames; i++) {
        while (this.position >= 1) { this.previous = this.current; this.current = this.sample(); this.position -= 1; }
        out[i] = this.previous + (this.current - this.previous) * this.position;
        this.position += step;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.start(this.next);
      this.next += frames / ctx.sampleRate;
    }
  }

  /** One OPL sample, running the driver's tick on the way past. */
  private sample(): number {
    if (this.tickCarry <= 0) { this.driver.tick(); this.tickCarry += OPL_RATE / TICK_RATE; }
    this.tickCarry--;
    return this.opl.sample();
  }

  // what the game's code calls, as the far calls to the driver did (SoundPort)
  setSong(n: number): void { this.driver.setSong(n); }
  songPlaying(n: number): boolean { return this.driver.songPlaying(n); }
  play(n: number, music = false): void { this.driver.play(n, music); }
  isPlaying(n: number): boolean { return this.driver.isPlaying(n); }
  stopAll(): void { this.driver.stopAll(); }
  stopVoices(): void { this.driver.stopVoices(); }
  engine(car: number, pitch: number, running: boolean): void { this.driver.engine(car, pitch, running); }
}
