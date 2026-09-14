/**
 * Frame test: for every VRAM capture in the per-step traces (vram_NNNN.bin, taken at the top of a loop iteration
 * right after the state dump), rebuild the frame the game had just presented: start from the state at the top of the
 * iteration that rendered it, run that iteration's input + physics, render, and compare pixel by pixel.
 * The whole 256x200 viewport is compared, HUD included.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { Race } from '../../src/engine/race';
import { RaceRenderer, applyPriorityFlags, type RenderSources } from '../../src/engine/render';
import { lzDecode } from '../../src/data/lzcodec';
import { decodeTileMap } from '../../src/data/tilemap';
import { decodeBlocks, expandMap } from '../../src/data/blocks';
import { decodeVehicle, frameTableBytes } from '../../src/data/sprites';
import { raceFileNames } from '../../src/engine/setup';

const GT = join(process.cwd(), 'build/golden/gt');
const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
const traces = existsSync(GT) && existsSync(join(DATA, 'GAME1', 'ROUND21.MAP'))
  ? readdirSync(GT).filter(n => n.startsWith('trace_') && !n.endsWith('_by_tick') && existsSync(join(GT, n, 'trace.json'))
    && readdirSync(join(GT, n)).some(f => /^vram_\d+\.bin$/.test(f)))
  : [];
const CARS_OFF = 0x1240, GLOB_OFF = 0x2600;
const ISR_VARS: [number, number][] = [[0x26CF, 2], [0x261E, 3]];

type Snapshot = { cars: Uint8Array; glob: Uint8Array };
function loadState(dir: string, t: number): Snapshot | undefined {
  const n = String(t).padStart(4, '0');
  const p = join(dir, `state_${n}.bin`);
  if (existsSync(p)) {
    const b = new Uint8Array(readFileSync(p));
    return { cars: b.subarray(0, 0x600), glob: b.subarray(GLOB_OFF - CARS_OFF, GLOB_OFF - CARS_OFF + 0x100) };
  }
  const c = join(dir, `cars_${n}.bin`), g = join(dir, `glob_${n}.bin`);       // older trace layout: two files, no gap
  if (!existsSync(c) || !existsSync(g)) return undefined;
  return { cars: new Uint8Array(readFileSync(c)).subarray(0, 0x600), glob: new Uint8Array(readFileSync(g)) };
}
/** Overlay a snapshot on the data segment; everything between the car structs and the globals keeps the start image. */
function applyState(ds: DataSegment, s: Snapshot): void { ds.m.set(s.cars, CARS_OFF); ds.m.set(s.glob, GLOB_OFF); }

function sources(ds: DataSegment, round: number, track: number): RenderSources {
  const n = raceFileNames(round, track);
  ds.m.set(lzDecode(read(n['ph0']!)).data, 0x3FE3);            // fn 482f: HUD/foam/skid bits live at ds:3fe3
  const blk = decodeBlocks(read(n['ct']!), read(n['col']!), read(n['dir']!), read(n['lev']!));
  const mapWords = expandMap(blk, decodeTileMap(read(n['map']!)).blocks);
  applyPriorityFlags(mapWords, round);
  const parts = ['pr0', 'pr1', 'pr2'].filter(k => existsSync(join(DATA, n[k]!))).map(k => lzDecode(read(n[k]!)).data);
  const banks = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((o, p) => { banks.set(p, o); return o + p.length; }, 0);
  const vh0 = lzDecode(read(n['vh0']!)).data;
  if (round === 8) ds.m.set(vh0.subarray(0x1440, 0x1440 + 0x1400), 0x5EE3);   // fn 4611: rotor images over the PH0 area
  const vehicle = frameTableBytes(decodeVehicle(vh0, round));
  const extra = round === 9 ? vh0.slice(0x3840, 0x3840 + 0x1F40) : vh0.slice(0x1440, 0x1440 + 0x1B00);
  return { ds, mapWords, banks, vehicle, extra };
}

describe.skipIf(traces.length === 0)('race frames vs DOSBox-X VRAM captures', () => {
  for (const name of traces) {
    const dir = join(GT, name);
    const vrams = readdirSync(dir).filter(f => /^vram_\d+\.bin$/.test(f)).map(f => Number(f.slice(5, 9))).sort((a, b) => a - b);
    for (const t of vrams) {
      if (t < 2) continue;
      it(`${name} frame at step ${t}`, () => {
        const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')) as { inputs_p1: number[]; round?: number; track?: number; pokes?: Record<string, [number, number[]][]> };
        const stT = loadState(dir, t)!;
        const pacing = stT.glob[0x2638 - GLOB_OFF]! | (stT.glob[0x2639 - GLOB_OFF]! << 8);
        const r = pacing === 2 ? t : t - 1;                       // iteration whose render produced this VRAM
        const seed = loadState(dir, r - 1)!, isrEnd = loadState(dir, r)!, isrTop = loadState(dir, r - 2) ?? seed;
        const vram = new Uint8Array(readFileSync(join(dir, `vram_${String(t).padStart(4, '0')}.bin`))).subarray(0, 64000);
        const attempt = (isr: Snapshot): string[] => {
          const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
          applyState(ds, seed);
          for (const [o, l] of ISR_VARS) ds.m.set(isr.glob.subarray(o - GLOB_OFF, o - GLOB_OFF + l), o);
          for (const [off, vals] of meta.pokes?.[String(r)] ?? []) ds.m.set(vals, off);   // debugger pokes at the top of iteration r
          const race = new Race(ds);
          race.stepPhysics(meta.inputs_p1[r]!);
          expect(race.rendersThisStep).toBe(true);
          const renderer = new RaceRenderer(sources(ds, meta.round ?? 2, meta.track ?? 1)); renderer.race = race;
          const frame = renderer.render(() => race.renderSideEffects());
          const bad: string[] = [];
          for (let y = 0; y < 200; y++) for (let x = 32; x < 288; x++) {
            if (frame[y * 320 + x] !== vram[y * 320 + x] && bad.length < 10) bad.push(`(${x - 32},${y}) ${frame[y * 320 + x]} vs ${vram[y * 320 + x]}`);
          }
          return bad;
        };
        // int 8 variables (blink) may flip before or after the render inside the iteration: accept either snapshot
        let bad = attempt(isrEnd);
        if (bad.length) bad = attempt(isrTop);
        expect(bad).toEqual([]);
      });
    }
  }
});
