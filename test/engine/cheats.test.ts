/**
 * The pause key and the CHEATS.BIN spots (fn 35f0), and the two combinations the cheat code unlocks on the
 * pause screen. See re/notes/53-cheats.md.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { decodeCheats } from '../../src/data/cheats';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(DATA, 'GAME1', 'ROUND11.MAP'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

describe.skipIf(!have)('pause and the CHEATS.BIN spots', () => {
  function build(round: number, track: number): Race {
    const names = raceFileNames(round, track);
    const exe = unpackPklite(read('MICRO.EXE')).image;
    const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT'))
      ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');
    const opt = (n: string): Uint8Array | undefined => (existsSync(join(DATA, n)) ? read(n) : undefined);
    const files: RaceFiles = {
      exe, settings: new Uint8Array(readFileSync(settingsPath)),
      brk: opt(names['brk']!), lev: opt(names['lev']!), strtPos: read(names['strtPos']!), cheats: read(names['cheats']!),
      map: read(names['map']!), ct: read(names['ct']!), col: read(names['col']!), dir: read(names['dir']!),
      pal: read(names['pal']!), ph0: read(names['ph0']!), vh0: read(names['vh0']!),
      pr: ['pr0', 'pr1', 'pr2'].map(k => names[k]!).filter(n => existsSync(join(DATA, n))).map(read),
    };
    const assets = setupRace(files, {
      round, track, challengeIndex: 1, mode: 1, inputs: [4, 6, 6, 6], characters: [3, 5, 6, 6],
    });
    return new Race(assets.ds);
  }

  /** The key the shipped SETTINGS.DAT puts at index 14 of the table, which is bit 1 of [107c]. */
  const PAUSE = 2;

  it('CHEATS.BIN decodes into the ten effects the pause handler knows', () => {
    const recs = decodeCheats(read('GAME1/CHEATS.BIN'));
    expect(recs.length).toBe(30);
    expect(recs[0]).toEqual({ round: 1, track: 1, x: 1110, y: 1432, kind: 0, value: 1 });
    expect(recs.every(r => r.kind <= 9)).toBe(true);
    expect(recs.every(r => r.round >= 1 && r.round <= 9 && r.track >= 1 && r.track <= 4)).toBe(true);
  });

  it('the pause key stops the race and puts the banner up', () => {
    const race = build(1, 1);
    const d = race.d;
    race.raceLoopInit();
    race.stepPhysics(0);
    expect(race.paused).toBe(false);

    d.w16(0x107C, PAUSE);
    race.stepPhysics(0, PAUSE);
    expect(race.paused).toBe(true);
    expect(race.pauseStage).toBe(1);
    expect(d.r16(0x2633)).toBe(1);
    expect(d.r16(0x127A)).toBe(0);                       // fn 7af8 silenced the engines

    for (let t = 0; t < 0x8C; t++) { d.add16(0x261F, 1); race.pauseStep(); }
    expect(race.pauseStage).toBe(2);                     // the banner timed out
    expect(race.pauseRender).toBe(true);

    d.w16(0x107C, 0); d.w8(0x107E, 0x39);                // the pause key comes back up
    expect(race.pauseStep()).toBe(true);
    expect(race.pauseStep()).toBe(false);                // no cheat code, so no debug keys
    expect(race.paused).toBe(false);
    expect(d.r16(0x2633)).toBe(0);
  });

  it('standing on the round 1 track 1 spot takes a life', () => {
    const race = build(1, 1);
    const d = race.d;
    d.w8(0x0406, 3);
    d.w16(0x125C, 1110); d.w16(0x1268, 1432);            // the record's (x, y)
    race.raceLoopInit();
    d.w16(0x107C, PAUSE);
    race.stepPhysics(0, PAUSE);
    expect(d.r8(0x0406)).toBe(2);
    expect(race.pauseFlash).toBe(true);
  });

  it('a spot two blocks away does nothing', () => {
    const race = build(1, 1);
    const d = race.d;
    d.w8(0x0406, 3);
    d.w16(0x125C, 1110 + 0x18); d.w16(0x1268, 1432);
    race.raceLoopInit();
    d.w16(0x107C, PAUSE);
    race.stepPhysics(0, PAUSE);
    expect(d.r8(0x0406)).toBe(3);
    expect(race.pauseFlash).toBe(false);
    expect(race.paused).toBe(true);
  });

  it('F2 + F3 on the pause screen ends the race, but only with the cheat code', () => {
    for (const cheat of [0, 1]) {
      const race = build(1, 1);
      const d = race.d;
      d.w8(0x0F69, cheat);
      race.raceLoopInit();
      d.w16(0x107C, PAUSE);
      race.stepPhysics(0, PAUSE);
      d.w8(0x107E, 0x39);
      race.pauseStep();                                  // stage 1 -> 2
      race.pauseStep();                                  // stage 2 -> 3
      d.w16(0x107C, 0x300);                              // F2 + F3 held
      race.pauseStep();
      expect(d.r16(0x26C6)).toBe(cheat === 1 ? 4 : 0);
    }
  });

  it('F1 + F2 gives the car the round 7 jump', () => {
    const race = build(1, 1);
    const d = race.d;
    d.w8(0x0F69, 1);
    race.raceLoopInit();
    d.w16(0x107C, PAUSE);
    race.stepPhysics(0, PAUSE);
    d.w8(0x107E, 0x39);
    race.pauseStep(); race.pauseStep();
    d.w16(0x107C, 0x600);
    expect(race.pauseStep()).toBe(false);
    expect(d.r16(0x2919)).toBe(1);
    expect(d.r16(0x291B)).toBe(4);
  });
});
