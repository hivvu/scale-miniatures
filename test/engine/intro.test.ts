/**
 * The intro (src/engine/intro.ts) against the DOSBox-X capture of SM.EXE: one break per animation frame at
 * cs:097f, so vram_NNNN.bin is the screen as it was at the top of frame NNNN. The port must produce the same
 * 320x200 bytes frame after frame.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Intro } from '../../src/engine/intro';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const GT = join(ROOT, 'build/golden/gt/intro');
const frames = existsSync(GT) && existsSync(join(DATA, 'SM.EXE'))
  ? readdirSync(GT).filter(f => /^vram_\d+\.bin$/.test(f)).map(f => Number(f.slice(5, 9))).sort((a, b) => a - b)
  : [];
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

describe.skipIf(frames.length === 0)('intro vs the SM.EXE capture', () => {
  // built in beforeAll, not here: vitest runs a describe body even when it is going to skip the block,
  // so reading the game's files at this level breaks `npm test` on a machine that has none
  let intro: Intro;
  beforeAll(() => { intro = new Intro(read('SM.EXE'), read('GFX1.GFX'), read('ANTIFONT.BIN')); });

  it('uses the palette SM.EXE sets', () => {
    const captured = join(GT, 'intro_pal.bin');
    if (!existsSync(captured)) return;
    const want = new Uint8Array(readFileSync(captured)).map(v => v & 0x3F);   // the DAC only latches six bits
    expect(Buffer.from(intro.palette).equals(Buffer.from(want))).toBe(true);
  });

  it('runs the letters, the slide, the sweep and the hold, then asks to leave', () => {
    const run = new Intro(read('SM.EXE'), read('GFX1.GFX'), read('ANTIFONT.BIN'));
    let frames = 0;
    while (run.step()) {
      frames++;
      if (frames > 1000) break;
    }
    // 35 frames of slide, 30 of sweep, then fn 0aac holds the finished picture for 0xfa more
    expect(frames).toBe(35 + 30 + 0xFA - 2);
  });

  it('a click cuts it short', () => {
    const run = new Intro(read('SM.EXE'), read('GFX1.GFX'), read('ANTIFONT.BIN'));
    expect(run.step()).toBe(true);
    run.click();
    expect(run.step()).toBe(false);
  });

  // the capture breaks at the top of the loop, so frame n holds what frames 0..n-1 drew
  let drawn = 0;
  for (const n of frames) {
    it(`frame ${n}`, () => {
      while (drawn < n) { intro.step(); drawn++; }
      const want = new Uint8Array(readFileSync(join(GT, `vram_${String(n).padStart(4, '0')}.bin`))).subarray(0, 64000);
      let bad = 0, first = '';
      for (let i = 0; i < 64000; i++) {
        if (intro.vram[i] !== want[i]) {
          bad++;
          if (!first) first = `x=${i % 320} y=${Math.floor(i / 320)} got ${intro.vram[i]!.toString(16)} want ${want[i]!.toString(16)}`;
        }
      }
      expect(`${bad} ${first}`).toBe('0 ');
    });
  }
});
