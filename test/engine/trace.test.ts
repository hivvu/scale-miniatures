/**
 * Replay the DOSBox-X race traces (build/golden/gt/trace_*, produced by tools/gt_trace.py, not committed)
 * through the TypeScript race step and require a byte-exact match of the car structs and race globals
 * after every logic step. Skipped when no trace is present.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { Race, CARS } from '../../src/engine/race';

const GT = join(process.cwd(), 'build/golden/gt');
const traces = existsSync(GT) ? readdirSync(GT).filter(n => n.startsWith('trace_') && !n.endsWith('_by_tick')
  && existsSync(join(GT, n, 'ds_full_start.bin')) && existsSync(join(GT, n, 'trace.json'))) : [];

const CARS_OFF = 0x1240, GLOB_OFF = 0x2600;
// blink flag/counter and tick counter are owned by int 8 and can change mid-iteration; the value at the end of the
// iteration (the next dump) is the better estimate of what the render saw (round 4 trace, step 5)
const ISR_VARS: [number, number][] = [[0x26CF, 2], [0x261E, 3]];

function loadStep(dir: string, t: number): { cars: Uint8Array; glob: Uint8Array } | undefined {
  const st = join(dir, `state_${String(t).padStart(4, '0')}.bin`);
  if (existsSync(st)) {
    const b = new Uint8Array(readFileSync(st));
    return { cars: b.subarray(0, 0x600), glob: b.subarray(GLOB_OFF - CARS_OFF, GLOB_OFF - CARS_OFF + 0x100) };
  }
  const c = join(dir, `cars_${String(t).padStart(4, '0')}.bin`), g = join(dir, `glob_${String(t).padStart(4, '0')}.bin`);
  if (!existsSync(c) || !existsSync(g)) return undefined;
  return { cars: new Uint8Array(readFileSync(c)), glob: new Uint8Array(readFileSync(g)) };
}

function describeDiff(ds: DataSegment, cars: Uint8Array, glob: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < cars.length; i++) if (ds.m[CARS_OFF + i] !== cars[i]) {
    const off = CARS_OFF + i;
    const car = CARS.findIndex(bx => off >= bx + 0x124A && off < bx + 0x124A + 0x164);
    out.push(car >= 0 ? `car${car}+${(off - CARS[car]!).toString(16)}` : off.toString(16));
  }
  for (let i = 0; i < glob.length; i++) {
    const off = GLOB_OFF + i;
    if (ISR_VARS.some(([o, l]) => off >= o && off < o + l)) continue;
    if (ds.m[off] !== glob[i]) out.push(`[${off.toString(16)}]`);
  }
  return [...new Set(out)];
}

describe.skipIf(traces.length === 0)('race step vs DOSBox-X traces', () => {
  for (const name of traces) {
    it(name, () => {
      const dir = join(GT, name);
      const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')) as { inputs_p1: number[]; pokes?: Record<string, [number, number[]][]> };
      const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
      const race = new Race(ds);
      let first = loadStep(dir, 0);
      expect(first).toBeTruthy();
      ds.m.set(first!.cars, CARS_OFF); ds.m.set(first!.glob, GLOB_OFF);
      let steps = 0;
      for (let t = 1; ; t++) {
        const prev = loadStep(dir, t - 1), cur = loadStep(dir, t);
        if (!cur || !prev) break;
        for (const [off, vals] of meta.pokes?.[String(t)] ?? []) ds.m.set(vals, off);
        const before = ds.m.slice(), overBefore = race.over;
        for (const [o, l] of ISR_VARS) ds.m.set(cur.glob.subarray(o - GLOB_OFF, o - GLOB_OFF + l), o);
        race.step(meta.inputs_p1[t]!);
        let diff = describeDiff(ds, cur.cars, cur.glob);
        if (diff.length) {                                    // the int 8 flip may have happened after the render: retry with the top-of-iteration values
          ds.m.set(before); race.over = overBefore;
          for (const [o, l] of ISR_VARS) ds.m.set(prev.glob.subarray(o - GLOB_OFF, o - GLOB_OFF + l), o);
          race.step(meta.inputs_p1[t]!);
          diff = describeDiff(ds, cur.cars, cur.glob);
        }
        expect(diff, `step ${t} (input ${meta.inputs_p1[t]})`).toEqual([]);
        steps++;
      }
      expect(steps).toBeGreaterThan(50);      // short traces (interrupted captures) still count
      // race end: the capture recorded the iteration that leaves the loop (fn 30df) and the frames it holds
      const endMeta = join(dir, 'end.json');
      if (existsSync(endMeta)) {
        const { steps: n } = JSON.parse(readFileSync(endMeta, 'utf8')) as { steps: number };
        expect(n).toBe(steps + 1);
        race.step(meta.inputs_p1[n]!);
        expect(race.over).toBe(true);
        const end = new Uint8Array(readFileSync(join(dir, 'end_state_0000.bin')));
        const diff = describeDiff(ds, end.subarray(0, 0x600), end.subarray(GLOB_OFF - CARS_OFF, GLOB_OFF - CARS_OFF + 0x100));
        expect(diff).toEqual([]);
      }
    });
  }
});
