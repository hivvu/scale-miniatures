/**
 * The camera, apart from the game.
 *
 * This exists because of a fact that is easy to miss and expensive to find out later: **in this game the
 * camera is a rule, not a view.** Whether a car is on screen decides the catch up boost (fn 4aee leaves it
 * in [262f]), the respawn after a heavy round 6 collision, whether a car is released from its freeze after
 * a respawn ([137e]), and how loud its engine is. There is one camera, it lives in the data segment, and
 * everything above reads it.
 *
 * Which is fine with one person at the machine, and is the whole problem with four people on four machines:
 * a camera per player would be four different answers to those questions and four different races. So the
 * camera is split in two. The one in the data segment stays exactly where it was and keeps deciding; the
 * one here is only where a machine is *looking*, is never written to the data segment, and is read by the
 * drawing alone (`RaceRenderer.view`). Two machines with different views run the same race, byte for byte.
 *
 * `swoop` is the original's own glide (fn 5133) pulled out as plain arithmetic, so the view moves with the
 * same feel as the game's camera rather than an invented one.
 */
import { DataSegment, s16 } from './memory';
import type { Viewport } from './viewport';

/** How fast the camera is allowed to move, once it has settled. [264e]/[2650] hold this in the game. */
export const SETTLED = 0x32;
/** Further than this and it does not glide at all, it jumps. */
const JUMP = 0x3E8;

/**
 * One axis of the glide. Returns where the camera now is and how fast it may move next time.
 *
 * The comparison is done on plain 16-bit numbers, so a target on the far side of the world seam reads as a
 * gap of about 0xb00 and the camera jumps the whole way instead of gliding in. That is what the original
 * does, traces pin it, and `off` is how a viewport wider than the original's keeps the same decision.
 */
export function swoop(target: number, cam: number, step: number, off: number): { cam: number; step: number } {
  const diff = s16(((target + off) % 0xC00) - ((cam + off) % 0xC00));
  const far = diff <= -1 ? -diff : diff;
  let move: number;
  if (far > JUMP || far <= step) { step = SETTLED; move = diff; }
  else move = diff <= -1 ? -step : step;
  let now = s16((cam + move) & 0xFFFF);
  if (off !== 0) now = ((now % 0xC00) + 0xC00) % 0xC00;      // a world coordinate again
  return { cam: now & 0xFFFF, step };
}

/** Where the camera wants to be for one car: fn 4fd1's own sum, its position less its own camera offset. */
export function targetOf(d: DataSegment, bx: number): { x: number; y: number } {
  let x = s16(d.r16(bx + 0x125C) - d.r16(bx + 0x1262));
  if (x <= -1) x += 0xC00;
  let y = s16(d.r16(bx + 0x1268) - d.r16(bx + 0x126E));
  if (y <= -1) y += 0xC00;
  return { x, y };
}

/**
 * Where one machine is looking. Not part of the race: nothing here is ever written back to the data
 * segment, so two machines watching different cars still agree about everything that matters.
 */
export class View {
  x = 0;
  y = 0;
  private stepX = 8;                 // the value the race starts with, see setup fn 4220
  private stepY = 8;

  constructor(private readonly vp: Viewport) {}

  /** Puts the view on a car at once, with no glide. Used when the race starts. */
  jumpTo(d: DataSegment, bx: number): void {
    const t = targetOf(d, bx);
    this.x = t.x; this.y = t.y;
    this.stepX = SETTLED; this.stepY = SETTLED;
  }

  /**
   * Glides towards a car. `steps` is how many logic steps have passed since the last time, because the
   * game's camera moves once per step while a frame is drawn every `[263a]` of them, and a view that
   * glided once a frame would trail the game's own camera by that factor.
   */
  follow(d: DataSegment, bx: number, steps = 1): void {
    const t = targetOf(d, bx);
    for (let i = 0; i < steps; i++) {
      const x = swoop(t.x, this.x, this.stepX, this.vp.camOffsetX);
      this.x = x.cam; this.stepX = x.step;
      const y = swoop(t.y, this.y, this.stepY, this.vp.camOffsetY);
      this.y = y.cam; this.stepY = y.step;
    }
  }
}
