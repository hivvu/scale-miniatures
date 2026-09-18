/**
 * Four people in one race, which the original can never have.
 *
 * Two players was the machine's limit, so the race reset hands cars 2 and 3 to the AI and marks them as its
 * own ([bx+12eb]). Online there can be four, and the two things that have to be true are proved here: a byte
 * handed in for car 2 or car 3 actually steers it, and four machines doing this still produce one race.
 *
 * The second half matters more than it looks. A car the AI is still marked as driving would be steered by
 * the AI *and* read from the wire, which looks fine on one screen and is a different race on the other.
 *
 * The other half of a four player race is the camera, and it is tested in test/engine/camera.test.ts: in
 * this game being on screen is a rule, so the drawing gets a camera of its own and the one in the data
 * segment is left to decide.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, CARS, type RaceFiles, type RaceParams } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { DOS_VIEWPORT } from '../../src/engine/viewport';
import { Sim } from '../../src/net/Sim';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(DATA, 'GAME1', 'ROUND11.MAP'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

function files(round: number, track: number): RaceFiles {
  const names = raceFileNames(round, track);
  const opt = (n: string): Uint8Array | undefined => (existsSync(join(DATA, n)) ? read(n) : undefined);
  const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT'))
    ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');
  return {
    exe: unpackPklite(read('MICRO.EXE')).image, settings: new Uint8Array(readFileSync(settingsPath)),
    brk: opt(names['brk']!), lev: opt(names['lev']!), strtPos: read(names['strtPos']!), cheats: read(names['cheats']!),
    map: read(names['map']!), ct: read(names['ct']!), col: read(names['col']!), dir: read(names['dir']!),
    pal: read(names['pal']!), ph0: read(names['ph0']!), vh0: read(names['vh0']!),
    pr: ['pr0', 'pr1', 'pr2'].map(k => names[k]!).filter(n => existsSync(join(DATA, n))).map(read),
  };
}

const FOUR: RaceParams = {
  round: 2, track: 1, challengeIndex: 0, mode: 1,
  inputs: [4, 5, 4, 5], characters: [3, 5, 10, 6], humanCars: 4, viewport: DOS_VIEWPORT,
};

function four(): Race {
  return new Race(setupRace(files(2, 1), FOUR).ds, DOS_VIEWPORT);
}

describe.skipIf(!have)('a four car race with nobody left for the AI', () => {
  it('leaves none of the four marked as the AI\'s', () => {
    const d = four().d;
    for (let i = 0; i < 4; i++) expect(d.r16(CARS[i]! + 0x12EB)).toBe(0);
  });

  it('still hands cars 2 and 3 to the AI when nobody asked for them', () => {
    // The default is the original's, and a missing humanCars must change nothing at all.
    const plain: RaceParams = { ...FOUR, inputs: [4, 6, 6, 6], characters: [10, 6, 6, 6] };
    delete (plain as { humanCars?: number }).humanCars;
    const a = setupRace(files(2, 1), plain).ds;
    const b = setupRace(files(2, 1), { ...plain, humanCars: 0 }).ds;
    expect(a.m).toEqual(b.m);
    expect(a.r16(CARS[2]! + 0x12EB)).toBe(1);
    expect(a.r16(CARS[3]! + 0x12EB)).toBe(1);
  });

  it('drives car 3 from the wire and not from the AI', () => {
    const still = new Sim(four(), (car, step) => (car === 3 ? 0 : 0x20), 2);
    const going = new Sim(four(), (car, step) => (car === 3 ? 0x20 : 0x20), 2);
    still.advanceTo(200);
    going.advanceTo(200);
    // Same everything except what car 3 was told to do, so anything that differs is car 3 moving.
    expect(going.d.r16(CARS[3]! + 0x12E3)).toBeGreaterThan(still.d.r16(CARS[3]! + 0x12E3));
    expect(still.hash()).not.toBe(going.hash());
  });

  it('is one race on four machines', () => {
    const keys = (car: number, step: number): number => {
      let v = Math.imul((car + 1) * 2246822519 + step * 2654435761, 0x27220A95) >>> 0;
      v ^= v >>> 13;
      return 0x20 | ((v & 0xFF) < 90 ? ((v >> 9) & 1 ? 0x80 : 0x40) : 0);
    };
    const sims = [0, 1, 2, 3].map(() => new Sim(four(), keys, 2));
    for (const s of sims) s.advanceTo(600);
    for (const s of sims) expect(s.hash()).toBe(sims[0]!.hash());
  });
});
