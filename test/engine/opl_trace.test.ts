/**
 * The sound driver against the real one: build/golden/gt/sound/opl holds the OPL2 driver's whole work area
 * (register shadow, channel records, request queues, tempo accumulators) dumped every few game ticks while
 * the title song plays under DOSBox-X. Seed the port with one sample, run the ticks in between, and the
 * 256-byte register shadow, the channel records and the queues have to come out the same.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SoundDriver } from '../../src/engine/sound/driver';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const SOUND = join(ROOT, 'build/golden/gt/sound');
type Meta = { step: number; samples: { sample: number; tick: number }[]; state_at: number; state_len: number };
const traces = existsSync(SOUND) && existsSync(join(DATA, 'DRIVER1.BIN'))
  ? readdirSync(SOUND).filter(n => n.startsWith('opl') && existsSync(join(SOUND, n, 'opl.json'))).sort()
  : [];

const SHADOW = 0x114D, SLOTS = 0x1271, SLOT_LEN = 0x16, SLOTS_N = 16;
const EFFECT_QUEUE = 0x13D1, MUSIC_QUEUE = 0x13D9;

describe.skipIf(traces.length === 0)('OPL2 driver vs the DOSBox-X capture', () => {
  let image: Uint8Array;                     // read in beforeAll: a describe body runs even when skipped
  beforeAll(() => { image = new Uint8Array(readFileSync(join(DATA, 'DRIVER1.BIN'))); });
  const hex = (b: Uint8Array): string => Array.from(b, v => v.toString(16).padStart(2, '0')).join(' ');

  for (const trace of traces) {
  const GT = join(SOUND, trace);
  const meta = JSON.parse(readFileSync(join(GT, 'opl.json'), 'utf8')) as Meta;
  const state = (n: number): Uint8Array =>
    new Uint8Array(readFileSync(join(GT, `state_${String(n).padStart(2, '0')}.bin`)));
  const at = meta.state_at;

  for (let i = 0; i + 1 < meta.samples.length; i++) {
    const ticks = meta.samples[i + 1]!.tick - meta.samples[i]!.tick;
    // an interval the capture walks the menus through is skipped: the game asks for another song in the
    // middle of it, and the driver alone cannot know that
    if (ticks !== meta.step) continue;
    it(`${trace} sample ${i} + ${ticks} ticks == sample ${i + 1}`, () => {
      const drv = new SoundDriver(image, { write: () => {} });
      drv.loadState(state(i), at);
      for (let t = 0; t < ticks; t++) drv.tick();
      const got = drv.saveState(at, meta.state_len);
      const want = state(i + 1);

      // the register shadow is the driver's whole output
      const gs = got.subarray(SHADOW - at, SHADOW - at + 0x100);
      const ws = want.subarray(SHADOW - at, SHADOW - at + 0x100);
      const bad: string[] = [];
      for (let r = 0; r < 0x100; r++) {
        if (gs[r] !== ws[r]) bad.push(`${r.toString(16)}: got ${gs[r]!.toString(16)} want ${ws[r]!.toString(16)}`);
      }
      expect(bad.join(', ')).toBe('');

      for (let s = 0; s < SLOTS_N; s++) {
        const o = SLOTS - at + s * SLOT_LEN;
        expect(`${s}: ${hex(got.subarray(o, o + SLOT_LEN))}`).toBe(`${s}: ${hex(want.subarray(o, o + SLOT_LEN))}`);
      }
      for (const q of [EFFECT_QUEUE, MUSIC_QUEUE]) {
        expect(hex(got.subarray(q - at, q - at + 8))).toBe(hex(want.subarray(q - at, q - at + 8)));
      }
    });
  }
  }
});
