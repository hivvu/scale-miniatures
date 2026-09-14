// Diagnostic tool (skipped unless MM_TRACE is set): our intermediate car values inside one step, per physics phase.
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { Race } from '../../src/engine/race';
it.skipIf(!process.env['MM_TRACE'])('diag phases', () => {
  const dir = join(process.cwd(), 'build/golden/gt', process.env['MM_TRACE']!); const T = Number(process.env['MM_STEP'] ?? 160);
  const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  const ld = (k: number) => new Uint8Array(readFileSync(join(dir, `state_${String(k).padStart(4, '0')}.bin`)));
  const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
  const seed = ld(T - 1), prev = ld(T);
  ds.m.set(seed.subarray(0, 0x600), 0x1240); ds.m.set(seed.subarray(0x2600 - 0x1240, 0x2600 - 0x1240 + 0x100), 0x2600);
  for (const [o, l] of [[0x26CF, 2], [0x261E, 3]] as [number, number][]) ds.m.set(prev.subarray(o - 0x1240, o - 0x1240 + l), o);
  for (const [off, vals] of (meta.pokes?.[String(T)] ?? []) as [number, number[]][]) ds.m.set(vals, off);
  const race = new Race(ds) as any;
  const show = (label: string) => console.log(label, [0, 0x164, 0x2C8, 0x42C].map((bx, i) => `c${i}: pos ${ds.r16(bx + 0x125C).toString(16)},${ds.r16(bx + 0x1268).toString(16)} cand ${ds.r16(bx + 0x125E).toString(16)},${ds.r16(bx + 0x126A).toString(16)} vel ${ds.r16(bx + 0x1272).toString(16)},${ds.r16(bx + 0x1276).toString(16)} [12ac]=${ds.r16(bx + 0x12AC)} st=${ds.r16(bx + 0x12AE).toString(16)}`).join(' | '));
  race.fn2d5bInput(meta.inputs_p1[T], 0);
  for (const bx of [0, 0x164, 0x2C8, 0x42C]) race.carControl(bx);
  show('after control ');
  for (const p of [0x2660, 0x2662, 0x2664, 0x2666]) race.fn525eMove(ds.r16(p));
  show('after moves   ');
  race.fn5921Collisions();
  show('after collide ');
});
