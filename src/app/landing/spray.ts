/**
 * The wake behind the boat, taken from the game.
 *
 * Round 2 is the powerboats, and fn 8083 is what draws their wake: a ring of eight entries, each holding a
 * pair of points, one new pair every third rendered frame. A point is dropped about seven pixels from the
 * middle of the hull, at an angle that is the heading turned right round plus an offset, and that offset
 * walks up and down in steps of 0x14 (in 256ths of a turn), bouncing when it passes 0x1D. The two sides
 * start in opposite corners of that sweep, from ds:[128e] = -0x1E and ds:[1292] = +0x1E, which is why the
 * two trails weave across each other instead of running parallel. Every entry ages on the same third-frame
 * beat and is gone once it has been through all eight of its images.
 *
 * None of the game's foam images are here: those live in BITSFILE.PH0 and are Codemasters'. This file is
 * the geometry and the timing; the page draws its own ring.
 */

/** fn 8083 re-arms its gate with 3, so a pair is dropped, and everything ages, every third frame. */
export const EMIT_EVERY = 3;
/** An entry dies once its age passes 7, which with the gate above is eight pairs in the air at once. */
export const AGES = 8;
/** How far from the middle of the hull a point lands: the game's sine table shifted down four bits. */
export const RADIUS = 7.5;
/** The zig-zag, in 256ths of a turn, from ds:[128e]/[1290] and ds:[1292]/[1294]. */
export const WOBBLE_LIMIT = 0x1D, WOBBLE_STEP = 0x14, WOBBLE_START = 0x1E;

export interface Bit { x: number; y: number; age: number }

export class Spray {
  readonly bits: Bit[] = [];
  /** Port and starboard, each with where its next point goes and which way that is walking. */
  private readonly wobble = [
    { off: -WOBBLE_START, step: WOBBLE_STEP },
    { off: WOBBLE_START, step: -WOBBLE_STEP },
  ];
  private due = EMIT_EVERY;

  /** One frame of the game's clock, with the boat where it is and pointing where it points. */
  frame(x: number, y: number, a: number): void {
    if (--this.due > 0) return;
    this.due = EMIT_EVERY;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      if (++this.bits[i]!.age >= AGES) this.bits.splice(i, 1);
    }
    for (const w of this.wobble) {
      const th = a + Math.PI + w.off * 2 * Math.PI / 256;
      this.bits.push({ x: x + RADIUS * Math.sin(th), y: y - RADIUS * Math.cos(th), age: 0 });
      w.off += w.step;
      if (Math.abs(w.off) > WOBBLE_LIMIT) w.step = -w.step;
    }
  }

  /** A ring of foam around a point, for something arriving on the water or getting out of the way. */
  splash(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const th = i * Math.PI / 3;
      this.bits.push({ x: x + 7 * Math.cos(th), y: y + 7 * Math.sin(th), age: 0 });
    }
  }

  clear(): void { this.bits.length = 0; }

  /** Where the two trails are heading right now, in 256ths of a turn off dead astern. Only the tests care. */
  get offsets(): number[] { return this.wobble.map(w => w.off); }
}
