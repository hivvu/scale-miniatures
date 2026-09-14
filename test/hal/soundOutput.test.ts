/**
 * The Web Audio glue (src/hal/audio/SoundOutput.ts) against a stand-in AudioContext: the queue is filled
 * ahead of the playhead, and what it renders is the driver's own output resampled, not silence.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SoundOutput } from '../../src/hal/audio/SoundOutput';

const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const file = join(DATA, 'DRIVER1.BIN');

class FakeBuffer {
  readonly data: Float32Array;
  constructor(readonly length: number) { this.data = new Float32Array(length); }
  getChannelData(): Float32Array { return this.data; }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  readonly scheduled: { at: number; buffer: FakeBuffer }[] = [];
  createGain(): unknown { return { gain: { value: 0 }, connect: () => undefined }; }
  createBuffer(_channels: number, length: number): FakeBuffer { return new FakeBuffer(length); }
  createBufferSource(): unknown {
    const ctx = this;
    let buffer: FakeBuffer | undefined;
    return {
      set buffer(b: FakeBuffer) { buffer = b; },
      get buffer(): FakeBuffer | undefined { return buffer; },
      connect: () => undefined,
      start: (at: number) => ctx.scheduled.push({ at, buffer: buffer! }),
    };
  }
  resume(): Promise<void> { return Promise.resolve(); }
  get destination(): unknown { return {}; }
}

describe.skipIf(!existsSync(file))('sound output', () => {
  it('queues audio ahead of the playhead and plays the song', () => {
    const ctx = new FakeContext();
    vi.stubGlobal('AudioContext', function (this: unknown) { return ctx; });
    const out = new SoundOutput(new Uint8Array(readFileSync(file)));
    out.start();
    expect(out.running).toBe(true);
    out.setSong(1);
    out.pump();
    expect(ctx.scheduled.length).toBeGreaterThan(2);
    const queued = ctx.scheduled.reduce((n, s) => n + s.buffer.length, 0) / ctx.sampleRate;
    expect(queued).toBeGreaterThan(0.1);
    expect(queued).toBeLessThan(0.5);

    const before = ctx.scheduled.length;
    out.pump();
    expect(ctx.scheduled.length).toBe(before);              // nothing more is needed yet
    ctx.currentTime += 0.2;
    out.pump();
    expect(ctx.scheduled.length).toBeGreaterThan(before);

    let peak = 0;
    for (const s of ctx.scheduled) for (const v of s.buffer.data) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.02);                     // the title song is actually playing
    vi.unstubAllGlobals();
  });
});
