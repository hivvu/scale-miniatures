// Diagnostic tool (skipped unless MM_TRACE is set): render one captured frame and print the differing pixel clusters.
// MM_TRACE=trace_r2t1_current MM_STEP=101 npx vitest run test/engine/zz_diag.test.ts
import { it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSegment } from '../../src/engine/memory';
import { Race } from '../../src/engine/race';
import { RaceRenderer, applyPriorityFlags } from '../../src/engine/render';
import { lzDecode } from '../../src/data/lzcodec';
import { decodeTileMap } from '../../src/data/tilemap';
import { decodeBlocks, expandMap } from '../../src/data/blocks';
import { decodeVehicle, frameTableBytes } from '../../src/data/sprites';
import { raceFileNames } from '../../src/engine/setup';
const ROOT = process.cwd(), DATA = join(ROOT, 'MicroMac');
const read = (n: string) => new Uint8Array(readFileSync(join(DATA, n)));
it.skipIf(!process.env['MM_TRACE'])('diag', () => {
  const dir = join(ROOT, 'build/golden/gt', process.env['MM_TRACE'] ?? 'trace_r2t1_current'); const t = Number(process.env['MM_STEP'] ?? 101);
  const meta = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  const ld = (k: number) => new Uint8Array(readFileSync(join(dir, `state_${String(k).padStart(4, '0')}.bin`)));
  const stT = ld(t); const pacing = stT[0x2638 - 0x1240]! | (stT[0x2639 - 0x1240]! << 8); const r = pacing === 2 ? t : t - 1;
  const seed = ld(r - 1), prev = ld(r);
  const ds = new DataSegment(new Uint8Array(readFileSync(join(dir, 'ds_full_start.bin'))));
  ds.m.set(seed.subarray(0, 0x600), 0x1240); ds.m.set(seed.subarray(0x2600 - 0x1240, 0x2600 - 0x1240 + 0x100), 0x2600);
  for (const [o, l] of [[0x26CF, 2], [0x261E, 3]] as [number, number][]) ds.m.set(prev.subarray(o - 0x1240, o - 0x1240 + l), o);
  for (const [off, vals] of (meta.pokes?.[String(r)] ?? []) as [number, number[]][]) ds.m.set(vals, off);
  const race = new Race(ds); race.stepPhysics(meta.inputs_p1[r]);
  const rnd = meta.round ?? 2, trk = meta.track ?? 1, nm = raceFileNames(rnd, trk);
  ds.m.set(lzDecode(read(nm['ph0']!)).data, 0x3FE3);
  const blk = decodeBlocks(read(nm['ct']!), read(nm['col']!), read(nm['dir']!), read(nm['lev']!));
  const mapWords = expandMap(blk, decodeTileMap(read(nm['map']!)).blocks); applyPriorityFlags(mapWords, rnd);
  const parts = ['pr0', 'pr1', 'pr2'].filter(k => existsSync(join(DATA, nm[k]!))).map(k => lzDecode(read(nm[k]!)).data);
  const banks = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); parts.reduce((o, p) => { banks.set(p, o); return o + p.length; }, 0);
  const vh0 = lzDecode(read(nm['vh0']!)).data;
  if (rnd === 8) ds.m.set(vh0.subarray(0x1440, 0x1440 + 0x1400), 0x5EE3);
  const renderer = new RaceRenderer({ ds, mapWords, banks, vehicle: frameTableBytes(decodeVehicle(vh0, rnd)), extra: rnd === 9 ? vh0.slice(0x3840, 0x3840 + 0x1F40) : vh0.slice(0x1440, 0x1440 + 0x1B00) }); renderer.race = race;
  const frame = renderer.render(() => race.renderSideEffects());
  const vram = new Uint8Array(readFileSync(join(dir, `vram_${String(t).padStart(4, '0')}.bin`)));
  if (process.env['MM_OUT']) require('node:fs').writeFileSync(process.env['MM_OUT'], frame);
  const bad: [number, number, number, number][] = [];
  for (let y = 0; y < 200; y++) for (let x = 32; x < 288; x++) if (frame[y * 320 + x] !== vram[y * 320 + x]) bad.push([x - 32, y, frame[y * 320 + x]!, vram[y * 320 + x]!]);
  // cluster by 16px boxes
  const boxes = new Map<string, [number, number, number, number, number, string]>();
  for (const [x, y, a, b] of bad) { const k = `${x >> 4},${y >> 4}`; const e = boxes.get(k) ?? [x, y, x, y, 0, '']; e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.max(e[2], x); e[3] = Math.max(e[3], y); e[4]++; if (e[5].length < 40) e[5] += `${a}/${b} `; boxes.set(k, e); }
  console.log(`step ${t} (r=${r}) diffs=${bad.length}; cam ${ds.r16(0x264A).toString(16)},${ds.r16(0x264C).toString(16)}; car0 ${ds.r16(0x125C).toString(16)},${ds.r16(0x1268).toString(16)} state ${ds.r16(0x12AE).toString(16)} particles [1394]=${ds.r16(0x1394)} [13a4]=${ds.r16(0x13A4)} skids [1298]=${ds.rs16(0x1298)} tracks [1296]=${ds.rs16(0x1296)}`);
  if (process.env['MM_WIN']) {
    const [wx, wy, ww, wh] = process.env['MM_WIN'].split(',').map(Number) as [number, number, number, number];
    for (const [label, buf] of [['ours', frame], ['vram', vram]] as const) {
      console.log(label);
      for (let y = wy; y < wy + wh; y++) console.log('   ' + Array.from({ length: ww }, (_, i) => String(buf[y * 320 + 32 + wx + i]).padStart(3)).join(' '));
    }
  }
  for (const [k, e] of boxes) console.log(`  box ${k}: x ${e[0]}..${e[2]} y ${e[1]}..${e[3]} n=${e[4]} ours/vram: ${e[5]}`);
});
