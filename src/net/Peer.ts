/**
 * One machine's view of a networked race: what everybody pressed, what we guessed they pressed, and putting
 * the race right when the guess turns out wrong.
 *
 * Nothing here knows about sockets. It is given bytes and asked to advance; how the bytes arrive is the
 * transport's problem and how they are drawn is the page's. That is what lets the whole thing be driven by
 * a fake wire in a test or in the lab page, with real latency and real packet loss, before any of it has to
 * survive the internet.
 *
 * The rule that makes rollback correct: **every car's byte comes out of the log, including your own.** Read
 * your keyboard live and a replayed step would replay a different you, and the two machines would part
 * company on the first correction instead of the first dropped packet.
 */
import { Race } from '../engine/race';
import { hashBytes, type Checkpoint } from '../engine/tick';
import { Sim, type InputLog } from './Sim';

/** How far ahead of the last confirmed step a machine will run on guesses before it has to wait. */
export const DEFAULT_WINDOW = 12;

/**
 * One player's bytes over time. A step nobody has told us about yet is answered with the last one we do
 * know, which is the prediction: people hold the throttle down far more often than they change their mind.
 */
export class Track {
  private readonly bytes: number[] = [];
  /** The highest step actually received. Everything after it is a guess. */
  known = -1;

  /** Records a byte. Returns the step to roll back to when it contradicts what we had assumed. */
  set(step: number, byte: number): number | undefined {
    if (step <= this.known && this.bytes[step] === byte) return undefined;
    const guessed = this.at(step);
    for (let s = this.known + 1; s < step; s++) this.bytes[s] ??= guessed;   // fill any gap with the guess
    this.bytes[step] = byte;
    if (step > this.known) this.known = step;
    return guessed === byte ? undefined : step;
  }

  at(step: number): number {
    if (step <= this.known) return this.bytes[step] ?? 0;
    return this.known < 0 ? 0 : this.bytes[this.known] ?? 0;
  }
}

export class Peer {
  readonly sim: Sim;
  readonly tracks: Track[];
  /** The earliest step whose input changed after we had already run past it. */
  private dirty = Infinity;
  private readonly ring: Checkpoint[] = [];
  private spare: Uint8Array[] = [];
  /** Counters worth watching: how often we were wrong, and how far back we had to go. */
  rollbacks = 0;
  resimulated = 0;

  constructor(race: Race, readonly cars: number, stepsPerFrame?: number, readonly window = DEFAULT_WINDOW) {
    this.tracks = Array.from({ length: cars }, () => new Track());
    const log: InputLog = (car, step) => (car < cars ? this.tracks[car]!.at(step) : undefined);
    this.sim = new Sim(race, log, stepsPerFrame);
  }

  get step(): number { return this.sim.step; }
  get over(): boolean { return this.sim.over; }

  /** The last step every player's byte is actually known for: everything past it is being guessed. */
  get confirmed(): number {
    let c = Infinity;
    for (const t of this.tracks) c = Math.min(c, t.known);
    return c === Infinity ? -1 : c;
  }

  /** A byte arrived, ours or somebody else's. */
  input(car: number, step: number, byte: number): void {
    const from = this.tracks[car]?.set(step, byte);
    if (from !== undefined && from < this.sim.step) this.dirty = Math.min(this.dirty, from);
  }

  /**
   * Bring the race up to `target`, correcting first if a guess turned out wrong. Runs no further ahead of
   * what is confirmed than the window allows, because a machine that races too far into the dark spends all
   * its time rewinding.
   */
  advanceTo(target: number): void {
    this.correct();
    const limit = Math.min(target, this.confirmed + 1 + this.window);
    while (this.sim.step < limit && !this.sim.over) this.stepOnce();
  }

  private stepOnce(): void {
    this.keep(this.sim.save(this.spare.pop()));
    this.sim.advance();
  }

  /** Rewind to the earliest step whose input we got wrong, and run back up to where we were. */
  private correct(): void {
    if (this.dirty >= this.sim.step) { this.dirty = Infinity; return; }
    const was = this.sim.step;
    const from = this.dirty;
    const cp = this.at(from);
    this.dirty = Infinity;
    if (!cp) return;                       // older than the window: nothing to be done but carry on
    this.sim.load(cp);
    // Everything kept from here on describes a future that is not going to happen. Drop it, or a later
    // rollback finds one of these and rewinds into a state that was never real.
    while (this.ring.length > 0 && this.ring[this.ring.length - 1]!.step >= from) {
      this.spare.push(this.ring.pop()!.m);
    }
    this.rollbacks++;
    const draw = this.sim.onRender;
    this.sim.onRender = undefined;              // redo the state, not the pictures
    while (this.sim.step < was && !this.sim.over) { this.stepOnce(); this.resimulated++; }
    this.sim.onRender = draw;
  }

  /** The kept state for a step, if it is still in the window. */
  private at(step: number): Checkpoint | undefined {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i]!.step === step) return this.ring[i];
    return undefined;
  }

  private keep(cp: Checkpoint): void {
    this.ring.push(cp);
    while (this.ring.length > this.window) { const old = this.ring.shift()!; this.spare.push(old.m); }
  }

  /**
   * The state at the last step everybody's byte was actually known for, and its hash.
   *
   * This is the only hash worth sending anywhere. Where a machine is *now* includes its guesses about the
   * other players, and two machines guess about different people, so their current states are supposed to
   * differ and comparing them says nothing. What they must agree on is the past they have both been told
   * about. Comparing the wrong one turns normal prediction into a false alarm; it is the first thing this
   * got wrong.
   */
  confirmedHash(): { step: number; hash: number } | undefined {
    const c = this.confirmed;
    if (c < 0) return undefined;
    const cp = this.at(c + 1);                  // the state after the confirmed step ran
    return cp ? { step: c, hash: hashBytes(cp.m) } : undefined;
  }

  /** Only for a test or a lab: force the state somewhere, and see the desync detector notice. */
  poke(offset: number, value: number): void { this.sim.d.w8(offset, value); }

  /** Where this machine is right now, guesses and all. Useful to look at, never to compare. */
  hash(): number { return this.sim.hash(); }
}
