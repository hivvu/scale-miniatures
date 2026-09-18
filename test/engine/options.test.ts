/**
 * The two knobs the original never had: how many laps, and how many cars.
 *
 * Both are one word in the data segment and neither is a free parameter, because the code around them was
 * written knowing the answer. Three laps means the ranking can count from a literal 9 and the HUD can draw
 * one digit; four cars means every per-car table is four wide. These tests pin the two places where forty
 * laps would quietly turn the race order upside down, and the switch that runs a race with fewer cars.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, CARS, type RaceFiles, type RaceParams } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { RaceRenderer } from '../../src/engine/render';
import { DOS_VIEWPORT } from '../../src/engine/viewport';

const DATA = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

function assets(extra: Partial<RaceParams>): ReturnType<typeof setupRace> {
  const n = raceFileNames(2, 1);
  const opt = (f: string): Uint8Array | undefined => (existsSync(join(DATA, f)) ? read(f) : undefined);
  const files: RaceFiles = {
    exe: unpackPklite(read('MICRO.EXE')).image, settings: opt('SETTINGS.DAT'),
    brk: opt(n['brk']!), lev: opt(n['lev']!), strtPos: read(n['strtPos']!), cheats: read(n['cheats']!),
    map: read(n['map']!), ct: read(n['ct']!), col: read(n['col']!), dir: read(n['dir']!), pal: read(n['pal']!),
    ph0: read(n['ph0']!), vh0: read(n['vh0']!),
    pr: ['pr0', 'pr1', 'pr2'].map(k => n[k]!).filter(f => existsSync(join(DATA, f))).map(read),
  };
  return setupRace(files, {
    round: 2, track: 1, challengeIndex: 0, mode: 1, inputs: [4, 5, 4, 5], characters: [3, 5, 10, 6],
    viewport: DOS_VIEWPORT, ...extra,
  });
}

function race(extra: Partial<RaceParams>): Race {
  const r = new Race(assets(extra).ds, DOS_VIEWPORT);
  r.raceLoopInit();
  return r;
}

/** The top left corner of the viewport, which is where the laps to go are drawn. The frame is wider than
 *  the viewport: `outX` is the black margin either side. */
function corner(extra: Partial<RaceParams>): string {
  const a = assets(extra);
  const r = new Race(a.ds, DOS_VIEWPORT); r.raceLoopInit();
  const renderer = new RaceRenderer({ ds: a.ds, mapWords: a.mapWords, banks: a.banks, vehicle: a.vehicle,
    extra: a.extra, viewport: DOS_VIEWPORT });
  renderer.race = r;
  // Not the first frame: nothing is on screen until the race has actually started stepping.
  let frame: Uint8Array | undefined;
  for (let i = 0; i < 400; i++) {
    r.stepPhysics(0x20, 0x20);
    if (r.rendersThisStep) frame = renderer.render(() => r.renderSideEffects());
    r.stepPost();
  }
  if (!frame) throw new Error('nothing was drawn');
  const rows: number[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) rows.push(frame[y * DOS_VIEWPORT.outWidth + DOS_VIEWPORT.outX + x]!);
  }
  return rows.join(',');
}

describe.skipIf(!have)('how many laps', () => {
  it('is three unless asked otherwise, and the ask reaches every car', () => {
    for (const bx of CARS) expect(race({}).d.r16(bx + 0x12ED)).toBe(3);
    const long = race({ laps: 40 });
    for (const bx of CARS) expect(long.d.r16(bx + 0x12ED)).toBe(40);
  });

  it('keeps the order right where the original\'s literal 9 would turn it over', () => {
    // The score is (9 - laps left) * a lap's worth of progress. Past nine laps that subtraction goes
    // negative and wraps: a car with ten to go would score 255 and one with nine, having driven a lap
    // further, would score 0, and the HUD would swap them over at that exact moment.
    const r = race({ laps: 40 });
    const d = r.d;
    d.w16(CARS[0]! + 0x12ED, 9);                  // has driven one lap more
    d.w16(CARS[1]! + 0x12ED, 10);
    d.w16(CARS[2]! + 0x12ED, 10);
    d.w16(CARS[3]! + 0x12ED, 10);
    r.fn8dfcRanking();
    expect(d.r16(0x2678)).toBe(CARS[0]);          // in front of the list
    expect(d.r16(CARS[0]! + 0x12EF)).toBe(1);     // and first
  });

  it('draws a tens column once there are more laps than a digit holds', () => {
    // The original draws one digit, because three laps never needs two. Twelve has to show as twelve, and
    // two has to look exactly as it always did.
    expect(corner({ laps: 12 })).not.toBe(corner({ laps: 2 }));
    expect(corner({ laps: 2 })).toBe(corner({ laps: 2 }));
    expect(corner({ laps: 40 })).not.toBe(corner({ laps: 4 }));
  });

  it('never lets a car reverse over the line past what the race was set to', () => {
    const r = race({ laps: 12 });
    const d = r.d;
    d.w16(CARS[0]! + 0x12ED, 12);
    expect(d.rs16(CARS[0]! + 0x12ED)).toBeLessThanOrEqual(12);
  });
});

describe.skipIf(!have)('the catch up boost', () => {
  it('is on in the game and can be turned off for a race between people', () => {
    // fn 4aee leaves [262f] set for a car that has fallen off the camera, and the physics then helps it
    // along. Invisible when the cars it helps are the computer's; felt when they are somebody's.
    const on = race({}), off = race({});
    off.catchup = false;
    const CAR1 = 0x164;
    for (const r of [on, off]) {
      r.d.w16(CAR1 + 0x1250, 0);                 // car 1 is off the camera
      r.d.w16(0x2678, 0); r.d.w16(0x267A, CAR1); // and behind car 0 in the order
    }
    expect(on.catchupFlag(CAR1)).toBe(1);
    expect(on.d.r8(0x262F)).toBe(1);
    expect(off.catchupFlag(CAR1)).toBe(0);
    expect(off.d.r8(0x262F)).toBe(0);
  });
});

describe.skipIf(!have)('how many cars', () => {
  it('is four unless asked otherwise', () => {
    const d = race({}).d;
    for (const bx of CARS) expect(d.r16(bx + 0x124C)).toBe(1);
  });

  it('leaves the ones nobody asked for inactive, and they never move', () => {
    const r = race({ cars: 2, humanCars: 2 });
    const d = r.d;
    expect(d.r16(CARS[0]! + 0x124C)).toBe(1);
    expect(d.r16(CARS[1]! + 0x124C)).toBe(1);
    expect(d.r16(CARS[2]! + 0x124C)).toBe(0);
    expect(d.r16(CARS[3]! + 0x124C)).toBe(0);
    const where = CARS.map(bx => d.r16(bx + 0x125C));
    for (let i = 0; i < 300; i++) {
      r.stepPhysics(0x20, 0x20);
      if (r.rendersThisStep) r.renderSideEffects();
      r.stepPost();
    }
    expect(d.r16(CARS[0]! + 0x125C)).not.toBe(where[0]);     // the two that are racing have gone
    expect(d.r16(CARS[2]! + 0x125C)).toBe(where[2]);         // the two that are not have not
    expect(d.r16(CARS[3]! + 0x125C)).toBe(where[3]);
  });
});
