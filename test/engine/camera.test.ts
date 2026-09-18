/**
 * Where the camera puts the player, at every view size.
 *
 * The race starts with the camera down and to the right of where it settles, and swoops in. The distance
 * it swoops is measured in the original from the per-car anchors at [1262]/[126e], which the executable
 * ships with per-car values and which fn 525e only replaces once a car is moving. A wider view that did
 * not move them with it would hold the cars off-centre through the countdown and snap across on the first
 * move, which is exactly what happened before setup.ts learned about the viewport.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { DOS_VIEWPORT, makeViewport, type Viewport } from '../../src/engine/viewport';
import { RaceRenderer } from '../../src/engine/render';
import { View, targetOf, SETTLED } from '../../src/engine/camera';
const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
describe.skipIf(!existsSync(join(DATA, 'MICRO.EXE')))('the camera and the view size', () => {
  it('puts the player in the middle, and swoops in the same way, at every size', () => {
    for (const vp of [DOS_VIEWPORT, makeViewport(320, 200), makeViewport(384, 224), makeViewport(448, 240)]) {
      const n = raceFileNames(2, 1);
      const opt = (f: string): Uint8Array | undefined => existsSync(join(DATA, f)) ? read(f) : undefined;
      const files: RaceFiles = { exe: unpackPklite(read('MICRO.EXE')).image, settings: opt('SETTINGS.DAT'),
        brk: opt(n['brk']!), lev: opt(n['lev']!), strtPos: read(n['strtPos']!), cheats: read(n['cheats']!),
        map: read(n['map']!), ct: read(n['ct']!), col: read(n['col']!), dir: read(n['dir']!), pal: read(n['pal']!),
        ph0: read(n['ph0']!), vh0: read(n['vh0']!), pr: ['pr0','pr1','pr2'].map(k => n[k]!).filter(f => existsSync(join(DATA,f))).map(read) };
      const a = setupRace(files, { round: 2, track: 1, challengeIndex: 0, mode: 1, inputs: [4,6,6,6], characters: [3,5,6,6], viewport: vp });
      const race = new Race(a.ds, vp); race.raceLoopInit();
      const d = a.ds;
      const on = (): [number, number] => {
        const bx = d.r16(0x2660);
        return [((d.r16(bx + 0x125C) - d.r16(0x264A)) + 0xC00) % 0xC00, ((d.r16(bx + 0x1268) - d.r16(0x264C)) + 0xC00) % 0xC00];
      };
      const seed = on();
      for (let s = 0; s < 60; s++) { race.stepPhysics(0); race.stepPost(); }
      const end = on();
      expect(end, `${vp.width}x${vp.height} settles in the middle`).toEqual([vp.halfW, vp.halfH]);
      // and the swoop it arrives with is the same one the original has, whatever the size
      expect([seed[0] - vp.halfW, seed[1] - vp.halfH], `${vp.width}x${vp.height} start offset`).toEqual([148, 176]);
    }
  });
});

/**
 * The swoop itself, on every round and track. fn 5133 compares the target and the camera as plain 16-bit
 * numbers, so when the two sit on opposite sides of the world seam the gap reads as about 0xb00 and the
 * camera jumps the whole way in one step instead of gliding in. The original does that on some tracks and
 * the traces pin it; what must not happen is a bigger view moving the camera off the seam and so changing
 * which tracks jump, which is what was making round 5 track 2 and round 8 tracks 2 and 3 snap to the middle
 * as the race started.
 */
describe.skipIf(!existsSync(join(DATA, 'MICRO.EXE')))('the swoop', () => {
  /** Where the car sits in the view, step by step, as the original would measure it. */
  function swoop(round: number, track: number, vp: Viewport): string[] {
    const n = raceFileNames(round, track);
    const opt = (f: string): Uint8Array | undefined => existsSync(join(DATA, f)) ? read(f) : undefined;
    const files: RaceFiles = { exe: unpackPklite(read('MICRO.EXE')).image, settings: opt('SETTINGS.DAT'),
      brk: opt(n['brk']!), lev: opt(n['lev']!), strtPos: read(n['strtPos']!), cheats: read(n['cheats']!),
      map: read(n['map']!), ct: read(n['ct']!), col: read(n['col']!), dir: read(n['dir']!), pal: read(n['pal']!),
      ph0: read(n['ph0']!), vh0: read(n['vh0']!), pr: ['pr0','pr1','pr2'].map(k => n[k]!).filter(f => existsSync(join(DATA,f))).map(read) };
    const a = setupRace(files, { round, track, challengeIndex: 0, mode: 1, inputs: [4,6,6,6], characters: [3,5,6,6], viewport: vp });
    const race = new Race(a.ds, vp); race.raceLoopInit();
    const d = a.ds, out: string[] = [];
    const rel = (w: number, cam: number, off: number): number => (d.r16(w) - d.r16(cam) - off + 0x1800) % 0xC00;
    for (let s = 0; s <= 40; s++) {
      out.push(`${rel(0x125C, 0x264A, vp.camOffsetX)},${rel(0x1268, 0x264C, vp.camOffsetY)}`);
      race.stepPhysics(0); race.stepPost();
    }
    return out;
  }

  it('takes the original\'s path into every track, at every size', () => {
    for (let round = 1; round <= 9; round++) {
      for (let track = 1; track <= 3; track++) {
        if (!existsSync(join(DATA, raceFileNames(round, track)['map']!))) continue;
        const want = swoop(round, track, DOS_VIEWPORT);
        for (const vp of [makeViewport(320, 200), makeViewport(320, 224), makeViewport(384, 224), makeViewport(448, 240)]) {
          expect(swoop(round, track, vp), `round ${round} track ${track} at ${vp.width}x${vp.height}`).toEqual(want);
        }
      }
    }
  });
});

/**
 * The camera that draws and the camera that decides.
 *
 * Four people on four machines each need to watch their own car, and in this game that is not a matter of
 * taste: the camera in the data segment decides who gets the catch up boost (fn 4aee), who is released from
 * the freeze after a respawn ([137e]), and whose engine can be heard. A camera per player would be four
 * different answers and four different races. So the drawing gets its own camera and the data segment keeps
 * the game's. These tests are the two halves of that promise.
 */
describe.skipIf(!existsSync(join(DATA, 'MICRO.EXE')))('drawing from somewhere else', () => {
  const build = (humans: number): { ds: ReturnType<typeof setupRace> } => {
    const n = raceFileNames(2, 1);
    const opt = (f: string): Uint8Array | undefined => existsSync(join(DATA, f)) ? read(f) : undefined;
    const files: RaceFiles = { exe: unpackPklite(read('MICRO.EXE')).image, settings: opt('SETTINGS.DAT'),
      brk: opt(n['brk']!), lev: opt(n['lev']!), strtPos: read(n['strtPos']!), cheats: read(n['cheats']!),
      map: read(n['map']!), ct: read(n['ct']!), col: read(n['col']!), dir: read(n['dir']!), pal: read(n['pal']!),
      ph0: read(n['ph0']!), vh0: read(n['vh0']!), pr: ['pr0','pr1','pr2'].map(k => n[k]!).filter(f => existsSync(join(DATA,f))).map(read) };
    return { ds: setupRace(files, { round: 2, track: 1, challengeIndex: 0, mode: 1,
      inputs: [4, 5, 4, 5], characters: [3, 5, 10, 6], humanCars: humans, viewport: DOS_VIEWPORT }) };
  };

  it('never writes the view back into the race', () => {
    const a = build(4).ds;
    const race = new Race(a.ds, DOS_VIEWPORT); race.raceLoopInit();
    const renderer = new RaceRenderer({ ds: a.ds, mapWords: a.mapWords, banks: a.banks, vehicle: a.vehicle,
      extra: a.extra, viewport: DOS_VIEWPORT });
    renderer.race = race;
    for (let i = 0; i < 80; i++) {
      race.stepPhysics(0x20, 0x20);
      if (race.rendersThisStep) renderer.render(() => race.renderSideEffects());
      race.stepPost();
    }
    const before = a.ds.m.slice();
    renderer.view = { x: 0x400, y: 0x700 };            // nowhere near where the game is looking
    const odd = renderer.render(() => { /* the side effects are the race's, not the view's */ });
    expect(a.ds.m).toEqual(before);                    // the drawing changed nothing at all
    renderer.view = undefined;
    const usual = renderer.render(() => { /* as above */ });
    expect(a.ds.m).toEqual(before);
    expect(Buffer.from(odd)).not.toEqual(Buffer.from(usual));   // and it really did draw somewhere else
  });

  it('follows whoever is winning when the netplay driver asks it to', () => {
    const a = build(4).ds;
    const race = new Race(a.ds, DOS_VIEWPORT); race.raceLoopInit();
    race.followLeader = true;
    const d = a.ds;
    // Only car 3 is given the throttle, so it is the one in front.
    for (let i = 0; i < 300; i++) {
      race.supplied = car => (car === 3 ? 0x20 : 0);
      race.stepPhysics(0, 0);
      if (race.rendersThisStep) race.renderSideEffects();
      race.stepPost();
    }
    const CAR3 = 0x42C;
    expect(d.r16(CAR3 + 0x12EF)).toBe(1);              // it is first
    expect(d.r16(0x2646)).toBe(targetOf(d, CAR3).x);   // and the camera is aimed at it
    expect(d.r16(0x2648)).toBe(targetOf(d, CAR3).y);
  });

  it('glides a view onto its own car with the game\'s own step', () => {
    const a = build(4).ds;
    const race = new Race(a.ds, DOS_VIEWPORT); race.raceLoopInit();
    const view = new View(DOS_VIEWPORT);
    const CAR2 = 0x2C8;
    view.jumpTo(a.ds, CAR2);
    expect(view.x).toBe(targetOf(a.ds, CAR2).x);
    for (let i = 0; i < 200; i++) {
      race.supplied = car => (car === 2 ? 0x20 : 0);
      race.stepPhysics(0, 0);
      if (race.rendersThisStep) { view.follow(a.ds, CAR2, 2); race.renderSideEffects(); }
      race.stepPost();
    }
    // A camera that keeps up stays on its car; one that does not would have been left behind by now.
    const t = targetOf(a.ds, CAR2);
    expect(Math.abs(view.x - t.x)).toBeLessThanOrEqual(SETTLED);
    expect(Math.abs(view.y - t.y)).toBeLessThanOrEqual(SETTLED);
  });
});
