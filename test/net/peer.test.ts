/**
 * Two machines, a wire with real delay and real losses on it, and the demand that they end up in the same
 * race as each other and as a machine that had no network at all.
 *
 * This is the test the whole feature rests on. Everything else is plumbing around it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../src/engine/setup';
import { Race } from '../../src/engine/race';
import { DOS_VIEWPORT } from '../../src/engine/viewport';
import { Sim } from '../../src/net/Sim';
import { Peer, Track } from '../../src/net/Peer';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(DATA, 'GAME1', 'ROUND11.MAP'));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));

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

/** One player, driving the same way every time. */
function driver(seed: number) {
  return (step: number): number => {
    let v = Math.imul(seed * 2246822519 + step * 2654435761, 0x27220A95) >>> 0;
    v ^= v >>> 13;
    const turn = (v & 0xFF) < 90 ? ((v >> 9) & 1 ? 0x80 : 0x40) : 0;
    return 0x20 | turn | ((v & 0x3F) === 0 ? 0x10 : 0);
  };
}

/** How many recent steps every packet carries, so that losing one costs nothing. */
const REDUNDANCY = 8;

/**
 * A wire: everything posted arrives `lag` steps later, except what it drops.
 *
 * A packet carries the last `REDUNDANCY` bytes and not just the newest one, which is what makes a lost
 * packet a non-event: the next one covers it. Without that, one drop loses that step's input for ever and
 * the two machines disagree about it until the race ends. The real transport has to do the same, and this
 * is the property these tests assume of it.
 */
class Wire {
  private readonly queue: { at: number; car: number; from: number; bytes: number[] }[] = [];
  private readonly history: number[] = [];
  private sent = 0;
  constructor(private readonly lag: number, private readonly drop: (n: number) => boolean = () => false) {}

  post(now: number, car: number, step: number, byte: number): void {
    this.history[step] = byte;
    if (this.drop(this.sent++)) return;
    const from = Math.max(0, step - REDUNDANCY + 1);
    this.queue.push({ at: now + this.lag, car, from, bytes: this.history.slice(from, step + 1) });
  }

  deliver(now: number, to: Peer): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const p = this.queue[i]!;
      if (p.at > now) continue;
      p.bytes.forEach((b, k) => to.input(p.car, p.from + k, b));
      this.queue.splice(i, 1);
    }
  }

  get pending(): number { return this.queue.length; }
}

/** Runs two peers against each other over a wire, and returns them. */
function play(steps: number, lag: number, drop?: (n: number) => boolean, window = 12): [Peer, Peer] {
  const a = new Peer(build(), 2, 2, window);
  const b = new Peer(build(), 2, 2, window);
  const wires = [new Wire(lag, drop), new Wire(lag, drop)];   // a to b, b to a
  const me = [driver(1), driver(2)];
  for (let step = 0; step < steps; step++) {
    // Each machine knows its own byte at once and posts it to the other.
    for (const [car, peer, wire] of [[0, a, wires[0]!], [1, b, wires[1]!]] as const) {
      const byte = me[car]!(step);
      peer.input(car, step, byte);
      wire.post(step, car, step, byte);
    }
    wires[0]!.deliver(step, b);
    wires[1]!.deliver(step, a);
    a.advanceTo(step + 1);
    b.advanceTo(step + 1);
  }
  // The wire is still carrying the last few steps. Two machines only agree once it has drained, which is
  // also true of the real thing: at the flag, both sides settle before the result is final.
  for (let step = steps; step < steps + lag + 2; step++) {
    wires[0]!.deliver(step, b);
    wires[1]!.deliver(step, a);
    a.advanceTo(steps);
    b.advanceTo(steps);
  }
  return [a, b];
}

describe('predicting what somebody else pressed', () => {
  it('repeats the last byte it actually heard', () => {
    const t = new Track();
    expect(t.at(0)).toBe(0);                            // nothing heard yet: nothing pressed
    t.set(0, 0x20);
    expect(t.at(0)).toBe(0x20);
    expect(t.at(9)).toBe(0x20);                         // still holding the throttle, as far as we know
    expect(t.known).toBe(0);
  });

  it('says where to rewind to, and only when the guess was wrong', () => {
    const t = new Track();
    t.set(0, 0x20);
    expect(t.set(1, 0x20)).toBeUndefined();             // guessed right: nothing to redo
    expect(t.set(2, 0xA0)).toBe(2);                     // guessed wrong: from step 2
    expect(t.at(2)).toBe(0xA0);
  });

  it('fills a gap with what it had been assuming', () => {
    const t = new Track();
    t.set(0, 0x20);
    t.set(4, 0x60);                                     // steps 1..3 never arrived
    expect(t.at(2)).toBe(0x20);
    expect(t.at(4)).toBe(0x60);
    expect(t.known).toBe(4);
  });
});

describe.skipIf(!have)('two machines over a wire', () => {
  it('agree with each other and with a race that had no network', () => {
    const solo = new Sim(build(), (car, step) => (car < 2 ? driver(car + 1)(step) : undefined), 2);
    solo.advanceTo(800);

    const [a, b] = play(800, 4);
    expect(a.step).toBe(800);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).toBe(solo.hash());
    expect(a.rollbacks).toBeGreaterThan(0);             // it really did have to guess and correct
  });

  it('survive a wire that loses one packet in ten', () => {
    const solo = new Sim(build(), (car, step) => (car < 2 ? driver(car + 1)(step) : undefined), 2);
    solo.advanceTo(800);

    const [a, b] = play(800, 6, n => n % 10 === 3);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).toBe(solo.hash());
  });

  it('cost less to put right than to run in the first place', () => {
    // A sanity bound on the work: correcting should re-run a fraction of the steps, not all of them again
    // and again. If this ever blows up, the window or the prediction is wrong, not the machine.
    const [a] = play(800, 4);
    expect(a.resimulated).toBeLessThan(800 * 3);
  });
});
