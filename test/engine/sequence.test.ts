/**
 * The Challenge sequence end to end in node: the card before the qualifying race, a full race with the AI
 * driving every car, the finishing order and the verdict screen that follows. Needs the local game folder.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { DataSegment } from '../../src/engine/memory';
import { applySettings, setupRace, raceFileNames, DS_IMAGE_OFFSET, type RaceFiles } from '../../src/engine/setup';
import { FrontEnd, newArena, loadFrontEndBanks } from '../../src/engine/frontend';
import { Championship } from '../../src/engine/sequence';
import { Race } from '../../src/engine/race';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

describe.skipIf(!have)('challenge sequence', () => {
  it('runs the qualifying race and reaches a verdict', () => {
    const exe = unpackPklite(read('MICRO.EXE')).image;
    const ds = new DataSegment(exe.subarray(DS_IMAGE_OFFSET));
    const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT')) ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');
    applySettings(ds, new Uint8Array(readFileSync(settingsPath)));
    const mem = newArena();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 7; i++) parts.push(read(`COMPRESS.PI${i}`));
    loadFrontEndBanks(mem, parts, ds);
    const fe = new FrontEnd(ds, mem);
    fe.bindAllRecords();

    ds.w8(0x0156, 2);
    ds.w8(0x03F8, 0);
    ds.w16(0x2656, 1);
    const characters: [number, number, number, number] = [10, 6, 3, 1];
    for (let i = 0; i < 4; i++) {
      ds.w16(0x2658 + i * 2, 6);                       // every car driven by the AI
      ds.w16(0x2668 + i * 2, characters[i]!);
      ds.w16(0x0C03 + i * 0x1B + 0x13, characters[i]!);
    }

    const champ = new Championship(ds, fe);
    champ.begin();
    expect(champ.screen).toEqual({ kind: 'board' });    // fn 18d8 comes first, though race 0 draws nothing
    champ.screenDone();
    expect(champ.screen).toEqual({ kind: 'preRace', round: 2, track: 1 });

    champ.screenDone();
    expect(champ.screen.kind).toBe('race');

    const names = raceFileNames(2, 1);
    const files: RaceFiles = {
      exe, brk: read(names['brk']!), lev: read(names['lev']!), strtPos: read(names['strtPos']!), cheats: read(names['cheats']!),
      map: read(names['map']!), ct: read(names['ct']!), col: read(names['col']!), dir: read(names['dir']!), pal: read(names['pal']!),
      ph0: read(names['ph0']!), vh0: read(names['vh0']!), pr: [names['pr0']!, names['pr1']!, names['pr2']!].map(read),
    };
    setupRace(files, {
      round: 2, track: 1, challengeIndex: 0, mode: 1,
      inputs: [6, 6, 6, 6], characters,
    }, ds);
    for (const off of [0x12ED, 0x1451, 0x15B5, 0x1719]) ds.w16(off, 1);   // one lap each, as the captures do

    const race = new Race(ds);
    let steps = 0;
    while (!race.over && steps < 6000) { race.step(0); steps++; }
    expect(race.over).toBe(true);
    expect(steps).toBeGreaterThan(200);

    champ.raceFinished();
    const order = [0, 1, 2, 3].map(i => ds.r16(0x03FC + i * 2));
    expect(new Set(order)).toEqual(new Set([0x0C03, 0x0C1E, 0x0C39, 0x0C54]));
    expect(champ.screen.kind).toBe('verdict');

    champ.screenDone();
    expect(['chooseOpponents', 'end']).toContain(champ.screen.kind);

    if (champ.screen.kind === 'chooseOpponents') {      // the card for race 1 draws faces, track name and cars
      champ.screenDone();
      expect(champ.screen).toEqual({ kind: 'board' });
      champ.screenDone();
      expect(champ.screen).toEqual({ kind: 'preRace', round: 5, track: 2 });
      expect(fe.vram.some(v => v !== 0)).toBe(true);
    }
  });
});
