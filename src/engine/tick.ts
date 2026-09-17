/**
 * The clock, and the two things netplay needs from the state: a copy of it, and a number that says whether
 * two copies are the same.
 *
 * `timerTick` is fn 489c, the int 8 handler, and it lives here rather than with the menus because the race
 * needs it too. Nothing in the port has ever run it during a race: the page bumped a couple of the counters
 * by hand instead, off the animation clock (`src/app/game/main.ts`). That works for one machine and cannot
 * work for two, because the simulation reads those counters back: `[26cf]` gates the blink in fn 7cXX and
 * `[261f]` times the pause, so two machines whose clocks drift apart are two machines running different
 * games. Under `Sim` the counters are driven from the step number instead, and the wall clock decides only
 * when a step happens, never what it contains.
 *
 * A checkpoint is a copy of the data segment plus the two fields of `Race` that are not in it. That is the
 * whole of it, which is why rollback is cheap here: `test/engine/trace.test.ts` has been doing exactly this
 * to replay ground-truth traces since long before anyone thought about playing online.
 */
import type { DataSegment } from './memory';
import type { Race } from './race';

/** int 8 (fn 489c): the counters every wait loop spins on, and the 32-tick blink flag. */
export function timerTick(d: DataSegment): void {
  d.add16(0x28F7, 1);
  d.add16(0x0002, 1);
  d.add16(0x261F, 1);
  const n = (d.r8(0x26D0) + 1) & 0xFF;
  d.w8(0x26D0, n);
  if (n >= 0x20) { d.w8(0x26CF, d.r8(0x26CF) ^ 1); d.w8(0x26D0, 0); }
}

/**
 * How many int 8 ticks a displayed frame lasts, by SMOOTHNESS ([263a]). A frame holds [263a] logic steps
 * and takes this many ticks, so a step is not a tick and the two only line up at SMOOTHNESS 1.
 */
export const TICKS_PER_FRAME = [0, 1, 3, 5, 7, 32] as const;

/** The int 8 tick a logic step begins on, as whole numbers so it cannot drift between two machines. */
export function tickOfStep(step: number, stepsPerFrame: number): number {
  const perFrame = TICKS_PER_FRAME[stepsPerFrame] ?? 1;
  return Math.floor(step * perFrame / stepsPerFrame);
}

/**
 * FNV-1a over the whole segment. Two machines in step produce the same number; one number apart is a
 * desync, and the step it first happened on is the only useful thing to know about it.
 */
export function hashBytes(m: Uint8Array): number {
  let h = 0x811C9DC5;
  for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m[i]!, 0x01000193);
  return h >>> 0;
}

export function hashState(d: DataSegment): number { return hashBytes(d.m); }

/**
 * Everything a step depends on. The data segment is the game; `over` and `pauseStage` are the only two
 * fields of `Race` that decide what the next step does.
 *
 * `sounds` is not state, it is a queue the page drains, but its length is kept so that replaying a step
 * does not play the same engine note twice. The RNG seed is deliberately left out: it advances only in
 * `engineSound` and its output reaches nothing but the audio, so letting it drift costs a slightly
 * different pitch wobble and saves pretending it matters.
 */
export interface Checkpoint {
  readonly step: number;
  readonly tick: number;
  readonly m: Uint8Array;
  readonly over: boolean;
  readonly pauseStage: number;
  readonly sounds: number;
}

/**
 * `reuse` is a buffer from a checkpoint that is being thrown away, so that keeping a ring of them costs one
 * 64 KB copy a step and no allocation at all. Without it a rollback window is a megabyte of garbage a second.
 */
export function snapshot(step: number, tick: number, race: Race, reuse?: Uint8Array): Checkpoint {
  let m: Uint8Array;
  if (reuse && reuse.length === race.d.m.length) { reuse.set(race.d.m); m = reuse; } else m = race.d.m.slice();
  return { step, tick, m, over: race.over, pauseStage: race.pauseStage, sounds: race.sounds.length };
}

export function restore(cp: Checkpoint, race: Race): void {
  race.d.m.set(cp.m);
  race.over = cp.over;
  race.pauseStage = cp.pauseStage;
  race.sounds.length = cp.sounds;
}
