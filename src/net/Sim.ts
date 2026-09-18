/**
 * The race, advanced by step number instead of by clock.
 *
 * This is the whole of what makes two machines agree. The page's own loop (`src/app/game/main.ts`) decides
 * how many logic steps to run from how much wall-clock time has passed, bumps two of the int 8 counters by
 * hand from a floating accumulator, and reads the keyboard live at the moment of the step. Every one of
 * those is a machine-local decision, and the simulation reads all three back, so two pages running the same
 * race drift apart within seconds. Here the wall clock decides only *when* `advance` is called; what a step
 * contains comes from the step number and the input log, both of which the two machines share.
 *
 * A step is not a tick. A displayed frame holds `[263a]` logic steps and lasts `TICKS_PER_FRAME[[263a]]`
 * int 8 ticks, so at the default SMOOTHNESS a step is a tick and a half. `tickOfStep` does that in whole
 * numbers so it cannot drift, and the counters are run forward to meet it.
 *
 * Because the local player's byte comes out of the same log as everybody else's, replaying a step replays
 * it identically. That is what makes rollback correct rather than merely fast.
 */
import { Race } from '../engine/race';
import { timerTick, tickOfStep, snapshot, restore, hashState, type Checkpoint } from '../engine/tick';

/** The byte driving a car on a given step, or undefined for a car nobody out there is driving. */
export type InputLog = (car: number, step: number) => number | undefined;

export class Sim {
  /** Logic steps run so far. This is the number the two machines count in. */
  step = 0;
  /** int 8 ticks run so far, which trails the step count by the SMOOTHNESS ratio. */
  private tick = 0;
  readonly stepsPerFrame: number;

  /**
   * `stepsPerFrame` must be agreed between the machines and not read from the local SETTINGS.DAT, because
   * the game picks it with a benchmark (fn 3ad0) and a faster machine picks a bigger number. It is read by
   * the physics, not just by the pacing, so two values are two different games.
   */
  constructor(readonly race: Race, private readonly inputs: InputLog, stepsPerFrame?: number) {
    this.stepsPerFrame = stepsPerFrame ?? race.d.r16(0x263A);
    race.d.w16(0x263A, this.stepsPerFrame);
    race.raceLoopInit();
    race.supplied = car => this.inputs(car, this.step);
  }

  get d() { return this.race.d; }
  get over(): boolean { return this.race.over; }

  /**
   * Set by the page to draw the frame a step produces. fn 90c5 runs the skid and foam emitters from inside
   * the drawing pass, and the lists have to be drawn before the emitters add to them, so a page that wants
   * the right picture has to hand the drawing in rather than call it afterwards.
   *
   * Left unset while replaying, because a rollback redoes the state and not the pictures. The state comes
   * out the same either way: the renderer writes to its own buffer and touches nothing here.
   */
  onRender: ((sideEffects: () => void) => void) | undefined;

  /** One logic step, with the clock brought up to where the hardware would have it. */
  advance(): void {
    const target = tickOfStep(this.step + 1, this.stepsPerFrame);
    while (this.tick < target) { timerTick(this.d); this.tick++; }
    const r = this.race;
    r.stepPhysics(this.inputs(0, this.step) ?? 0, this.inputs(1, this.step) ?? 0);
    if (!r.over) {
      if (r.rendersThisStep) {
        if (this.onRender) this.onRender(() => r.renderSideEffects());
        else r.renderSideEffects();
      }
      r.stepPost();
    }
    this.step++;
  }

  /** Run to a step number. Used live to catch up, and after a rollback to get back to where we were. */
  advanceTo(step: number): void {
    while (this.step < step && !this.race.over) this.advance();
  }

  /** `reuse` is a buffer from a checkpoint that has fallen out of the rollback window. See tick.ts. */
  save(reuse?: Uint8Array): Checkpoint { return snapshot(this.step, this.tick, this.race, reuse); }

  load(cp: Checkpoint): void {
    restore(cp, this.race);
    this.step = cp.step;
    this.tick = cp.tick;
  }

  /** The number to send the other machine. Equal numbers mean equal games. */
  hash(): number { return hashState(this.d); }
}
