/**
 * The sound driver port (src/engine/sound/driver.ts) against DRIVER1.BIN itself: the bank it finds, and the
 * OPL2 register stream one of the game's sounds produces. Needs the local game folder.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SoundDriver } from '../../src/engine/sound/driver';
import { OPL2, OPL_RATE } from '../../src/engine/sound/opl2';

const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const file = join(DATA, 'DRIVER1.BIN');
const have = existsSync(file);

class Log {
  readonly writes: [number, number][] = [];
  write(reg: number, value: number): void { this.writes.push([reg, value]); }
  /** The writes to one register group: 0x20, 0x40, 0x60, 0x80 and 0xe0 cover two rows of operators. */
  regs(base: number): [number, number][] {
    const span = base === 0xA0 || base === 0xB0 || base === 0xC0 ? 9 : 0x16;
    return this.writes.filter(([r]) => r >= base && r < base + span);
  }
}

describe.skipIf(!have)('sound driver', () => {
  let image: Uint8Array;                     // read in beforeAll: a describe body runs even when skipped
  beforeAll(() => { image = new Uint8Array(readFileSync(file)); });

  function boot(): { d: SoundDriver; log: Log } {
    const log = new Log();
    const d = new SoundDriver(image, log);
    d.init();
    log.writes.length = 0;                       // the reset writes are not what these tests are about
    return { d, log };
  }

  it('the reset writes the registers the shadow already claims', () => {
    const log = new Log();
    const d = new SoundDriver(image, log);
    d.init();
    // fn 019d skips the shadow test, so the silence list lands on the chip even though the driver ships
    // believing every register is already 0xff. Without this the envelopes keep their reset release rate
    // of zero and every note rings on for ever.
    const release = log.writes.filter(([r]) => r >= 0x80 && r <= 0x95);
    expect(release.length).toBe(18);
    expect(release.every(([, v]) => v === 0xFF)).toBe(true);
    expect(log.writes.filter(([r]) => r >= 0x60 && r <= 0x75).length).toBe(18);
  });

  it('a sound effect leaves silence behind it', () => {
    const opl = new OPL2();
    const d = new SoundDriver(image, opl);
    d.init();
    d.play(1);
    const chunk = new Float32Array(Math.round(OPL_RATE / 70.086));
    let peak = 0;
    for (let tick = 0; tick < 210; tick++) {                 // three seconds
      d.tick();
      opl.render(chunk);
      if (tick > 175) for (const v of chunk) peak = Math.max(peak, Math.abs(v));
    }
    expect(d.isPlaying(1)).toBe(false);
    expect(peak).toBe(0);
  });

  it('finds the bank the driver points at', () => {
    const { d } = boot();
    expect(d.soundCount).toBe(18);
    expect(d.sequenceStart(1)).toBe(0x65D9);
    expect(d.sequenceStart(0x40)).toBe(0x0008);  // the first engine record
  });

  it('plays sound 1 as an instrument, a note and a note off', () => {
    const { d, log } = boot();
    d.play(1);
    d.tick();
    // Sound 1 is instrument 118 on OPL channel 8 (operators 0x12 and 0x15). The driver ships a register
    // shadow full of 0xff and skips a write that matches it, so the instrument's 0xff sustain/release
    // bytes never reach registers 0x92/0x95: the game really does leave them at whatever the chip has.
    const hex = log.writes.map(([r, v]) => `${r.toString(16)}=${v.toString(16)}`).join(' ');
    expect(hex).toBe('72=c2 75=85 f2=0 f5=0 c8=e 32=f3 35=3a a8=cc b8=21 55=c3 52=c4');
    expect(d.isPlaying(1)).toBe(true);
  });

  it('keys the note off and ends the sequence at the right tick', () => {
    const { d, log } = boot();
    d.play(1);
    let keyOffAt = -1, endAt = -1;
    for (let tick = 0; tick < 200; tick++) {
      const before = log.writes.length;
      d.tick();
      const b0 = log.writes.slice(before).filter(([r]) => r >= 0xB0 && r < 0xB9);
      if (keyOffAt < 0 && b0.some(([, v]) => (v & 0x20) === 0)) keyOffAt = tick;
      if (endAt < 0 && !d.isPlaying(1)) endAt = tick;
    }
    // the sequence waits 109 sequencer ticks before the note off and 18 more before the end; at 5760/4207
    // sequencer ticks per game tick that is about 80 and 93 game ticks
    expect(keyOffAt).toBeGreaterThan(70);
    expect(keyOffAt).toBeLessThan(90);
    expect(endAt).toBeGreaterThan(keyOffAt);
    expect(endAt).toBeLessThan(100);
  });

  it('gives every sound in the bank a free channel and stops them all again', () => {
    const { d } = boot();
    for (let n = 1; n <= 9; n++) d.play(n);
    d.tick();
    expect([1, 2, 3].every(n => d.isPlaying(n))).toBe(true);
    d.stopAll();
    d.tick();
    expect([1, 2, 3].some(n => d.isPlaying(n))).toBe(false);
  });

  it('the engine note takes its pitch from the record the game writes', () => {
    const { d, log } = boot();
    d.engine(0, 0x30, true);                     // fn 7b46 with a car doing about 480
    d.tick();                                    // ah=5 only queues: the tick gives it a channel
    expect(d.isPlaying(0x40)).toBe(true);
    for (let tick = 0; tick < 40; tick++) d.tick();
    const first = log.writes.filter(([r]) => r >= 0xA0 && r < 0xA9).map(([, v]) => v);
    expect(first.length).toBeGreaterThan(0);
    log.writes.length = 0;
    d.engine(0, 0x60, true);                     // faster: the same note, bent further up
    for (let tick = 0; tick < 40; tick++) d.tick();
    const second = log.writes.filter(([r]) => r >= 0xA0 && r < 0xA9).map(([, v]) => v);
    expect(second.length).toBeGreaterThan(0);
    expect(second).not.toEqual(first);
    d.engine(0, 0, false);                       // stopped: the sequence ends instead of looping
    for (let tick = 0; tick < 60; tick++) d.tick();
    expect(d.isPlaying(0x40)).toBe(false);
  });

  it('the engine note is bent, never retriggered', () => {
    const { d, log } = boot();
    d.engine(0, 0x30, true);
    for (let tick = 0; tick < 200; tick++) {
      d.engine(0, 0x30 + (tick & 0x0F), true);            // as fn 7b46 does, once a frame
      d.tick();
    }
    // 02a1: a sound number of 0x40 or more keeps its note down, so the key goes on once and stays on
    const keys = log.writes.filter(([r]) => r >= 0xB0 && r < 0xB9);
    expect(keys.filter(([, v]) => (v & 0x20) !== 0).length).toBe(1);
    expect(keys.filter(([, v]) => (v & 0x20) === 0).length).toBe(0);
    expect(log.writes.filter(([r]) => r >= 0xA0 && r < 0xA9).length).toBeGreaterThan(10);
  });

  it('the engine records loop instead of ending', () => {
    const { d, log } = boot();
    d.play(0x40);
    for (let tick = 0; tick < 300; tick++) d.tick();
    expect(d.isPlaying(0x40)).toBe(true);                 // command 0x98 sends it back to the loop point
    expect(log.writes.some(([r]) => r >= 0xA0 && r < 0xA9)).toBe(true);
  });
});
