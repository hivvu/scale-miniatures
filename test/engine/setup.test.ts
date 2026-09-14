/**
 * Race setup from files vs the DOSBox-X dump of the data segment at the top of the first race-loop iteration
 * (build/golden/gt/trace_r2t1/ds_full_start.bin, round 2 track 1, Challenge, keys 1 + 3 AI cars).
 * Regions owned by the interrupt handlers, the timer or the front-end menus are excluded. Needs the local game
 * folder and the dumps, so it is skipped when either is missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const GT = join(ROOT, 'build/golden/gt');
const DUMP = join(GT, 'trace_r2t1/ds_full_start.bin');
const UNPACKED = join(ROOT, 're/unpacked/MICRO_U.EXE');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(DUMP);

const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
const exeImage = (path: string): Uint8Array => {
  const f = new Uint8Array(readFileSync(path));
  return f.subarray((f[8]! | (f[9]! << 8)) * 16);
};

/** [start, end) ranges not reproduced by the setup: timer/ISR state, menu state, BIOS pointers. */
const EXCLUDED: [number, number, string][] = [
  [0x0000, 0x0010, 'int 8 tick counters'],
  [0x0156, 0x01A0, 'front-end menu state'],
  [0x03FA, 0x040A, 'front-end menu state'],
  [0x09FB, 0x0D63, 'front-end: COMPRESS.PI bank table, menu widgets'],
  [0x0D7D, 0x0D8B, 'front-end strings'],
  [0x260C, 0x2621, 'saved int 8 vector, timer reload, tick counter'],
  [0x26CF, 0x26D1, 'int 8 blink flag / counter'],
  [0x28F7, 0x28F9, 'int 8 tick count'],
  [0x2925, 0x2929, 'saved int 9 vector'],
  [0x2DA9, 0x2E72, 'challenge progress table (front end)'],
];

describe.skipIf(!have)('race setup from files', () => {
  const names = raceFileNames(2, 1);
  let exe: Uint8Array;                       // unpacked in beforeAll: a describe body runs even when skipped
  beforeAll(() => { exe = unpackPklite(read('MICRO.EXE')).image; });

  it.skipIf(!existsSync(UNPACKED))('PKLITE depacker reproduces the UNP image', () => {
    const ref = exeImage(UNPACKED);
    expect(exe.length).toBe(ref.length);
    expect(Buffer.from(exe).equals(Buffer.from(ref))).toBe(true);
  });

  it('data segment matches the DOSBox-X start-of-race dump', () => {
    const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT')) ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');
    const files: RaceFiles = {
      exe, settings: new Uint8Array(readFileSync(settingsPath)),
      brk: read(names['brk']!), lev: read(names['lev']!), strtPos: read(names['strtPos']!), cheats: read(names['cheats']!),
      map: read(names['map']!), ct: read(names['ct']!), col: read(names['col']!), dir: read(names['dir']!), pal: read(names['pal']!),
      ph0: read(names['ph0']!), vh0: read(names['vh0']!), pr: [names['pr0']!, names['pr1']!, names['pr2']!].map(read),
    };
    const { ds, mapWords } = setupRace(files, { round: 2, track: 1, challengeIndex: 0, mode: 1, inputs: [4, 6, 6, 6], characters: [10, 6, 6, 6] });
    const gt = new Uint8Array(readFileSync(DUMP));
    const diffs: string[] = [];
    for (let o = 0; o < 0x8000; o++) {
      if (EXCLUDED.some(([a, b]) => o >= a && o < b)) continue;
      if (ds.m[o] !== gt[o]) {
        const last = diffs[diffs.length - 1];
        const start = last ? parseInt(last.split('-')[0]!, 16) : -1;
        if (last && parseInt(last.split('-')[1]!.split(' ')[0]!, 16) === o) diffs[diffs.length - 1] = `${start.toString(16)}-${(o + 1).toString(16)} ${last.split(' ').slice(1).join(' ')}`;
        else diffs.push(`${o.toString(16)}-${(o + 1).toString(16)} built ${ds.m[o]!.toString(16)} vs ${gt[o]!.toString(16)}`);
      }
    }
    expect(diffs).toEqual([]);

    // expanded map (segments 3B78 / 4478, 96 rows each) with the priority bits set at race init
    const lo = join(GT, 'round2_track1_map/map_seg_3b78_lo.bin'), hi = join(GT, 'round2_track1_map/map_seg_3b78_hi.bin');
    if (existsSync(lo) && existsSync(hi)) {
      const seg = Buffer.concat([readFileSync(lo), readFileSync(hi)]);
      const bad: string[] = [];
      for (let i = 0; i < 192 * 96 && bad.length < 5; i++) {
        const w = seg[i * 2]! | (seg[i * 2 + 1]! << 8);
        if (w !== mapWords[i]) bad.push(`row ${Math.floor(i / 192)} col ${i % 192}: ${mapWords[i]!.toString(16)} vs ${w.toString(16)}`);
      }
      expect(bad).toEqual([]);
    }
  });
});
