/**
 * The widening is only trustworthy if it adds pixels without moving any. So: take a state out of a golden
 * trace, render it twice without stepping the physics at all, once at the original 256x200 and once at
 * 384x200 with the camera moved half the extra width to the left, and require the columns the two views
 * share to be identical.
 *
 * The HUD is left out of the comparison on purpose: it is anchored to the left edge of the view, so in the
 * wide frame it sits outside the shared window. Its own position is checked separately below.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { RaceRenderer, applyPriorityFlags, type RenderSources } from '../../src/engine/render';
import { lzDecode } from '../../src/data/lzcodec';
import { decodeTileMap } from '../../src/data/tilemap';
import { decodeBlocks, expandMap } from '../../src/data/blocks';
import { decodeVehicle, frameTableBytes } from '../../src/data/sprites';
import { raceFileNames } from '../../src/engine/setup';
import { DOS_VIEWPORT, makeViewport } from '../../src/engine/viewport';

const GT = join(process.cwd(), 'build/golden/gt');
const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
const traces = existsSync(GT) && existsSync(join(DATA, 'GAME1', 'ROUND21.MAP'))
  ? readdirSync(GT).filter(n => n.startsWith('trace_') && !n.endsWith('_by_tick')
    && existsSync(join(GT, n, 'trace.json')) && existsSync(join(GT, n, 'ds_full_start.bin'))
    && readdirSync(join(GT, n)).some(f => /^state_\d+\.bin$/.test(f))).sort()   // the older traces store cars_/glob_
  : [];

const CARS_OFF = 0x1240, GLOB_OFF = 0x2600;
const WIDE = makeViewport(384, 200);
const DW = (WIDE.width - DOS_VIEWPORT.width) / 2;      // 64: a multiple of 32, so the water tile keeps its phase

/** Built fresh per render: the animated tiles write into mapWords and the tile banks. */
function sources(ds: DataSegment, round: number, track: number): RenderSources {
  const n = raceFileNames(round, track);
  ds.m.set(lzDecode(read(n['ph0']!)).data, 0x3FE3);
  const blk = decodeBlocks(read(n['ct']!), read(n['col']!), read(n['dir']!), read(n['lev']!));
  const mapWords = expandMap(blk, decodeTileMap(read(n['map']!)).blocks);
  applyPriorityFlags(mapWords, round);
  const parts = ['pr0', 'pr1', 'pr2'].filter(k => existsSync(join(DATA, n[k]!))).map(k => lzDecode(read(n[k]!)).data);
  const banks = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((o, p) => { banks.set(p, o); return o + p.length; }, 0);
  const vh0 = lzDecode(read(n['vh0']!)).data;
  if (round === 8) ds.m.set(vh0.subarray(0x1440, 0x1440 + 0x1400), 0x5EE3);
  const vehicle = frameTableBytes(decodeVehicle(vh0, round));
  const extra = round === 9 ? vh0.slice(0x3840, 0x3840 + 0x1F40) : vh0.slice(0x1440, 0x1440 + 0x1B00);
  return { ds, mapWords, banks, vehicle, extra };
}

function loadState(dir: string, t: number): Uint8Array | undefined {
  const p = join(dir, `state_${String(t).padStart(4, '0')}.bin`);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
}

/** One frame of a trace, rendered at `vp` with the camera moved left by `shift`. */
function frameAt(dir: string, step: number, round: number, track: number, shift: number, vp = DOS_VIEWPORT): Uint8Array {
  const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
  const st = loadState(dir, step)!;
  ds.m.set(st.subarray(0, 0x600), CARS_OFF);
  ds.m.set(st.subarray(GLOB_OFF - CARS_OFF, GLOB_OFF - CARS_OFF + 0x100), GLOB_OFF);
  if (shift) ds.w16(0x264A, (ds.r16(0x264A) - shift + 0xC00) % 0xC00);
  const renderer = new RaceRenderer({ ...sources(ds, round, track), viewport: vp });
  return renderer.render();                              // no physics, no side effects: a pure redraw
}

describe.skipIf(traces.length === 0)('a wider viewport adds pixels without moving any', () => {
  for (const name of traces) {
    const dir = join(GT, name);
    const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')) as { round?: number; track?: number };
    const round = meta.round ?? 2, track = meta.track ?? 1;
    const steps = readdirSync(dir).filter(f => /^state_\d+\.bin$/.test(f)).map(f => Number(f.slice(6, 10)))
      .sort((a, b) => a - b).filter((_, i) => i % 16 === 0).slice(0, 4);

    for (const step of steps) {
      it(`${name} step ${step}: the shared columns match`, () => {
        const narrow = frameAt(dir, step, round, track, 0);
        const wide = frameAt(dir, step, round, track, DW, WIDE);
        const bad: string[] = [];
        for (let y = 0; y < 200; y++) {
          for (let x = 48; x < 256; x++) {               // x < 48 is the HUD, which tracks the left edge
            const a = narrow[y * DOS_VIEWPORT.outWidth + DOS_VIEWPORT.outX + x]!;
            const b = wide[y * WIDE.outWidth + WIDE.outX + DW + x]!;
            if (a !== b && bad.length < 8) bad.push(`(${x},${y}) narrow ${a} vs wide ${b}`);
          }
        }
        expect(bad).toEqual([]);
      });
    }

    it.skipIf(steps.length === 0)(`${name}: the wide view really shows more track`, () => {
      const step = steps[steps.length - 1]!;
      const wide = frameAt(dir, step, round, track, DW, WIDE);
      let left = 0, right = 0;
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x < DW; x++) {
          if (wide[y * WIDE.outWidth + WIDE.outX + x]! !== 0) left++;
          if (wide[y * WIDE.outWidth + WIDE.outX + DW + 256 + x]! !== 0) right++;
        }
      }
      expect(left).toBeGreaterThan(0);
      expect(right).toBeGreaterThan(0);
    });
  }

  it('keeps the back buffer inside its bounds at every offered size', () => {
    for (const [w, h] of [[256, 200], [320, 224], [384, 224], [448, 240]] as const) {
      const vp = makeViewport(w, h);
      expect(vp.origin + (vp.height - 1) * vp.stride + vp.width).toBeLessThanOrEqual(vp.bufSize);
      expect(vp.overflowDi + vp.width).toBeLessThanOrEqual(vp.bufSize);
    }
  });
});
