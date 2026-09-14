/**
 * Head to head smoke test: two cars, the player's one standing still, the computer's driving away. The port
 * has to reach fn 7759 (one car left behind), run the 0x40-tick score animation of fn 75d2, respawn both and
 * carry on, without falling into any of the paths that used to be NotImplementedYet.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { RaceRenderer } from '../../src/engine/render';
import { DOS_VIEWPORT, makeViewport, type Viewport } from '../../src/engine/viewport';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(DATA, 'GAME1', 'ROUND11.MAP'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

describe.skipIf(!have)('head to head race', () => {
  function build(round: number, track: number, vp: Viewport = DOS_VIEWPORT): { race: Race; renderer: RaceRenderer } {
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
      round, track, challengeIndex: 1, mode: 2, inputs: [4, 6, 6, 6], characters: [3, 5, 6, 6],
    });
    const race = new Race(assets.ds, vp);
    const renderer = new RaceRenderer({ ds: assets.ds, mapWords: assets.mapWords, banks: assets.banks, vehicle: assets.vehicle, extra: assets.extra, viewport: vp });
    renderer.race = race;
    return { race, renderer };
  }

  it('catches the standing car out, scores the point and puts both back on the track', () => {
    const { race, renderer } = build(1, 1);
    const d = race.d;
    expect(d.r16(0x2656)).toBe(2);
    expect(d.r16(0x26B4)).toBe(4);                       // the tug bar starts in the middle
    race.raceLoopInit();

    const states = new Set<number>();
    let caught = 0;
    for (let step = 0; step < 6000 && !race.over; step++) {
      race.stepPhysics(0);                               // player 1 never touches a key
      if (race.over) break;
      if (race.rendersThisStep) renderer.render(() => race.renderSideEffects());
      race.stepPost();
      race.sounds.length = 0;
      for (const bx of [0, 0x164]) states.add(d.r16(bx + 0x12AE));
      if (d.r16(0x26BA) === 0x40) caught++;
    }
    expect(caught).toBeGreaterThan(0);                   // fn 7759 -> fn 75d2 ran at least once
    expect(states.has(0x0B)).toBe(true);                 // the car that got away
    expect(states.has(0x0C)).toBe(true);                 // the one that was left behind
    expect(d.r16(0x26B4)).not.toBe(4);                   // the bar moved
    expect(d.r16(0x26B4)).toBeLessThanOrEqual(8);
  });

  it('runs the whole match out to a winner', () => {
    const { race, renderer } = build(1, 1);
    const d = race.d;
    race.raceLoopInit();
    let steps = 0;
    for (; steps < 200000 && !race.over; steps++) {
      race.stepPhysics(0);
      if (race.over) break;
      if (race.rendersThisStep) renderer.render(() => race.renderSideEffects());
      race.stepPost();
      race.sounds.length = 0;
    }
    expect(race.over).toBe(true);
    expect(d.r16(0x26B4)).toBe(0);                       // the computer driver took all eight points
    expect(d.r16(0x26C6)).toBe(2);
    expect(d.r16(0x26C4)).toBe(0x164);                   // fn 76ee: the winner's car record
  });

  /**
   * The point of widening: the scoring area is "both cars still fully inside the window", so it grows with
   * the view. At 384x224 the cars may drift 0x168 apart across and 0xd0 down instead of 0xe8 and 0xb0, which
   * is why the budget here is larger than the 6000 steps the same race needs at the original size.
   */
    it('scores on the wider thresholds, and takes longer to do it', () => {
      const wide = makeViewport(384, 224);
      expect(wide.h2hX).toBe(0x168);
      expect(wide.h2hY).toBe(0xC8);

      const stepsToFirstPoint = (vp: Viewport, budget: number): number | undefined => {
        const { race, renderer } = build(1, 1, vp);
        race.raceLoopInit();
        for (let step = 0; step < budget && !race.over; step++) {
          race.stepPhysics(0);
          if (race.over) break;
          if (race.rendersThisStep) renderer.render(() => race.renderSideEffects());
          race.stepPost();
          race.sounds.length = 0;
          if (race.d.r16(0x26BA) === 0x40) return step;
        }
        return undefined;
      };
      const narrow = stepsToFirstPoint(DOS_VIEWPORT, 6000);
      const widened = stepsToFirstPoint(wide, 20000);
      expect(narrow).toBeDefined();
      expect(widened).toBeDefined();
      expect(widened!).toBeGreaterThan(narrow!);            // more room means longer before a car is lost
    });
});
