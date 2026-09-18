/**
 * The ground the netplay stands on: the same inputs give the same game, and a checkpoint puts it back
 * exactly where it was.
 *
 * None of this needs a socket. If these fail, nothing built on top of them can work, and the failure would
 * otherwise show up as two people in different places on the same corner with no way to tell why.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { DOS_VIEWPORT } from '../../src/engine/viewport';
import { Sim, type InputLog } from '../../src/net/Sim';
import { hashState, tickOfStep, TICKS_PER_FRAME } from '../../src/engine/tick';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(DATA, 'GAME1', 'ROUND11.MAP'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

/** A race built from the files alone, which is the path that is byte-identical from parameters. */
function build(round = 2, track = 1): Race {
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
    round, track, challengeIndex: 1, mode: 2, inputs: [4, 5, 6, 6], characters: [3, 5, 6, 6], viewport: DOS_VIEWPORT,
  });
  return new Race(assets.ds, DOS_VIEWPORT);
}

/** Two players driving badly but repeatably: mostly on the throttle, turning every so often. */
function script(seed: number): InputLog {
  const byte = (car: number, step: number): number => {
    let v = Math.imul(seed + car * 7919 + step * 2654435761, 0x27220A95) >>> 0;
    v ^= v >>> 15;
    const turn = (v & 0xFF) < 70 ? ((v >> 8) & 1 ? 0x80 : 0x40) : 0;
    const brake = (v & 0x1F) === 0 ? 0x10 : 0;
    return 0x20 | turn | brake;                          // 0x20 = accelerate
  };
  return (car, step) => (car < 2 ? byte(car, step) : undefined);
}

/** Every byte of the state, which is the only comparison worth making. */
const bytes = (r: Race): Uint8Array => r.d.m.slice();

describe('the step clock', () => {
  it('turns steps into whole ticks, and never drifts', () => {
    // A frame is [263a] steps and TICKS_PER_FRAME ticks, so one frame's worth of steps is one frame's
    // worth of ticks however the two divide.
    for (let spf = 1; spf <= 5; spf++) {
      expect(tickOfStep(0, spf)).toBe(0);
      expect(tickOfStep(spf, spf)).toBe(TICKS_PER_FRAME[spf]);
      expect(tickOfStep(spf * 100, spf)).toBe(TICKS_PER_FRAME[spf]! * 100);
      for (let s = 1; s < 40; s++) expect(tickOfStep(s, spf)).toBeGreaterThanOrEqual(tickOfStep(s - 1, spf));
    }
  });
});

describe.skipIf(!have)('two machines running the same race', () => {
  it('end up in the same place, byte for byte', () => {
    const a = new Sim(build(), script(1), 2);
    const b = new Sim(build(), script(1), 2);
    for (let i = 0; i < 2000 && !a.over; i++) { a.advance(); b.advance(); }
    expect(a.step).toBe(b.step);
    expect(a.hash()).toBe(b.hash());
    expect(bytes(a.race)).toEqual(bytes(b.race));
  });

  it('do not, if their SMOOTHNESS differs', () => {
    // [263a] is picked by a benchmark on each machine (fn 3ad0) and is read by the physics, not just by
    // the pacing. This is the trap the whole design is built around, so it is worth proving it is real.
    const a = new Sim(build(), script(1), 2);
    const b = new Sim(build(), script(1), 3);
    for (let i = 0; i < 400; i++) { a.advance(); b.advance(); }
    expect(a.hash()).not.toBe(b.hash());
  });

  it('feel a single flipped input bit straight away', () => {
    const base = script(1);
    const a = new Sim(build(), base, 2);
    const b = new Sim(build(), (car, step) => {
      const v = base(car, step);
      return v === undefined ? undefined : (step === 300 && car === 1 ? v ^ 0x40 : v);
    }, 2);
    a.advanceTo(300); b.advanceTo(300);
    expect(a.hash()).toBe(b.hash());                     // identical right up to the flip
    a.advance(); b.advance();
    expect(a.hash()).not.toBe(b.hash());
  });

  it('drift apart when a player keeps steering differently', () => {
    // Deliberately not a one-frame flip. Head to head pulls both cars back together whenever one is left
    // behind (fn 7759 / 75d2), so a single frame of steering really can wash out over a few hundred steps.
    // What must not wash out is a player actually driving somewhere else.
    const base = script(1);
    const a = new Sim(build(), base, 2);
    const b = new Sim(build(), (car, step) => {
      const v = base(car, step);
      return v === undefined ? undefined : (car === 1 && step >= 300 ? (v & ~0xC0) | 0x80 : v);
    }, 2);
    for (let i = 0; i < 800; i++) { a.advance(); b.advance(); }
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe.skipIf(!have)('rolling back', () => {
  it('puts the race back exactly where it was', () => {
    const sim = new Sim(build(), script(2), 2);
    sim.advanceTo(200);
    const cp = sim.save();
    const at200 = bytes(sim.race);
    sim.advanceTo(400);
    expect(bytes(sim.race)).not.toEqual(at200);          // it did move on, or the test proves nothing
    sim.load(cp);
    expect(sim.step).toBe(200);
    expect(bytes(sim.race)).toEqual(at200);
    expect(sim.hash()).toBe(hashState({ m: at200 } as never));
  });

  it('replays to the same state it would have reached without stopping', () => {
    const straight = new Sim(build(), script(3), 2);
    straight.advanceTo(500);

    const rolled = new Sim(build(), script(3), 2);
    rolled.advanceTo(200);
    const cp = rolled.save();
    rolled.advanceTo(350);
    rolled.load(cp);
    rolled.advanceTo(500);

    expect(rolled.hash()).toBe(straight.hash());
    expect(bytes(rolled.race)).toEqual(bytes(straight.race));
  });

  it('corrects a wrong guess about the other player', () => {
    // This is rollback itself: run ahead on a predicted byte, find out it was wrong, rewind and replay.
    // The result has to be what a machine that never guessed would have had.
    const real = script(4);
    const truth = new Sim(build(), real, 2);
    truth.advanceTo(600);

    // The log is the caller's, and the Sim only reads it. Correcting a guess is correcting the log.
    let log: InputLog = (car, step) => (car === 1 && step >= 300 ? 0x20 : real(car, step));
    const sim = new Sim(build(), (car, step) => log(car, step), 2);
    sim.advanceTo(300);
    const cp = sim.save();
    sim.advanceTo(340);                                  // 40 steps into the dark, on a guess
    expect(sim.hash()).not.toBe(truth.hash());

    log = real;                                          // the truth arrived
    sim.load(cp);
    sim.advanceTo(600);

    expect(sim.hash()).toBe(truth.hash());
    expect(bytes(sim.race)).toEqual(bytes(truth.race));
  });
});

describe.skipIf(!have)('the supplied seam', () => {
  it('drives a car that no device is attached to', () => {
    const race = build();
    race.d.w16(0x2658, 6); race.d.w16(0x265A, 6);        // both cars on the computer
    const sim = new Sim(race, (car, step) => (step < 5 ? 0 : (car === 0 ? 0x20 : 0x80)), 2);
    sim.advanceTo(3);
    expect(race.d.r8(0x137B)).toBe(0);
    expect(race.d.r8(0x14DF)).toBe(0);
    sim.advanceTo(10);
    // Both cars, because a race with two people on it has to answer to both. [137b] is car 0, [14df] car 1.
    expect(race.d.r8(0x137B)).toBe(0x20);                // supplied wins over the source word
    expect(race.d.r8(0x14DF)).toBe(0x80);
  });
});
