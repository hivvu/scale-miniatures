// Diagnostic tool (skipped unless MM_TRACE is set): replay a trace and print the values of the first mismatching step.
import { it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { Race } from '../../src/engine/race';
it.skipIf(!process.env['MM_TRACE'])('diag trace', () => {
  const dir = join(process.cwd(), 'build/golden/gt', process.env['MM_TRACE']!);
  const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  const ld = (k: number) => { const p = join(dir, `state_${String(k).padStart(4, '0')}.bin`); return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined; };
  const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
  const race = new Race(ds);
  ds.m.set(ld(0)!.subarray(0, 0x600), 0x1240); ds.m.set(ld(0)!.subarray(0x2600 - 0x1240, 0x2600 - 0x1240 + 0x100), 0x2600);
  for (let t = 1; ; t++) {
    const prev = ld(t - 1), cur = ld(t); if (!cur || !prev) break;
    for (const [o, l] of [[0x26CF, 2], [0x261E, 3]] as [number, number][]) ds.m.set(cur.subarray(o - 0x1240, o - 0x1240 + l), o);
    for (const [off, vals] of (meta.pokes?.[String(t)] ?? []) as [number, number[]][]) ds.m.set(vals, off);
    const before = ds.m.slice(0x1240, 0x2700);
    race.step(meta.inputs_p1[t]);
    const diffs: string[] = [];
    for (let o = 0x1240; o < 0x1840; o += 1) if (ds.m[o] !== cur[o - 0x1240]) diffs.push(o.toString(16));
    for (let o = 0x2600; o < 0x2700; o += 1) if (!(o >= 0x26CF && o < 0x26D1) && !(o >= 0x261E && o < 0x2621) && ds.m[o] !== cur[o - 0x1240]) diffs.push(o.toString(16));
    if (diffs.length) {
      console.log(`first mismatch at step ${t} input ${meta.inputs_p1[t]}`);
      const words = new Set(diffs.map(h => parseInt(h, 16) & ~1));
      for (const o of [...words].sort((a, b) => a - b)) {
        const car = [0, 0x164, 0x2C8, 0x42C].findIndex(bx => o >= bx + 0x124A && o < bx + 0x124A + 0x164);
        const rel = car >= 0 ? `car${car}+${(o - [0, 0x164, 0x2C8, 0x42C][car]!).toString(16)}` : `[${o.toString(16)}]`;
        const w = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8)).toString(16);
        console.log(`  ${rel}: before ${w(before, o - 0x1240)} ours ${w(ds.m, o)} game ${w(cur, o - 0x1240)}`);
      }
      const bx = 0; const f = (o: number) => (cur[bx + o - 0x1240]! | (cur[bx + o - 0x1240 + 1]! << 8)).toString(16);
      console.log(`  game car0: state ${f(0x12AE)} pos ${f(0x125C)},${f(0x1268)} tgt ${f(0x125E)},${f(0x126A)} [12be]=${f(0x12BE)} [12c0]=${f(0x12C0)} [12c2]=${f(0x12C2)} [12b6]=${f(0x12B6)} [12b0]=${f(0x12B0)} [1382]=${f(0x1382)}`);
      break;
    }
  }
});
