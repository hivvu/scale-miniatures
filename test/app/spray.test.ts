/**
 * The boat's wake, which is a transliteration of fn 8083 and so is worth pinning like any other.
 *
 * What the game does, and what these check: a pair of points every third frame, seven and a half pixels
 * from the middle of the hull, dropped at an angle that walks in steps of 0x14 and bounces off +/-0x1D,
 * with the two sides starting in opposite corners of that sweep so the trails cross. Eight images each,
 * then gone, which leaves exactly eight pairs in the water at any time.
 */
import { describe, it, expect } from 'vitest';
import { Spray, AGES, EMIT_EVERY, RADIUS, WOBBLE_LIMIT, WOBBLE_STEP } from '../../src/app/landing/spray';

/** The newest pair, as 256ths of a turn off dead astern, which is how the game keeps it. */
function freshOffsets(s: Spray, a: number): number[] {
  return s.bits.filter(b => b.age === 0).map(b => {
    const th = Math.atan2(b.x, -b.y);                       // the heading convention is (sin, -cos)
    const off = (th - a - Math.PI) / (2 * Math.PI) * 256;
    return Math.round(((off % 256) + 384) % 256 - 128);
  });
}

describe('the wake', () => {
  it('drops a pair every third frame and nothing in between', () => {
    const s = new Spray();
    s.frame(0, 0, 0); s.frame(0, 0, 0);
    expect(s.bits).toHaveLength(0);
    s.frame(0, 0, 0);
    expect(s.bits).toHaveLength(2);
    expect(EMIT_EVERY).toBe(3);
  });

  it('puts both points the same distance from the middle of the hull', () => {
    const s = new Spray();
    for (let i = 0; i < EMIT_EVERY; i++) s.frame(40, 25, 0);
    for (const b of s.bits) expect(Math.hypot(b.x - 40, b.y - 25)).toBeCloseTo(RADIUS, 6);
  });

  it('walks the two trails through opposite corners of the sweep', () => {
    const s = new Spray();
    const seen: number[][] = [];
    for (let i = 0; i < 6 * EMIT_EVERY; i++) {
      s.frame(0, 0, 0);
      if ((i + 1) % EMIT_EVERY === 0) seen.push(freshOffsets(s, 0));   // only the frames that drop a pair
    }
    // One full period: out to the limit, bounce, back across, bounce. The second trail is its mirror.
    expect(seen.map(p => p[0])).toEqual([-30, -10, 10, 30, 10, -10]);
    expect(seen.map(p => p[1])).toEqual([30, 10, -10, -30, -10, 10]);
    expect(WOBBLE_STEP).toBe(0x14);
    expect(WOBBLE_LIMIT).toBe(0x1D);
  });

  it('never lets a point past the limit, whichever way the boat is pointing', () => {
    const s = new Spray();
    for (let i = 0; i < 400; i++) {
      s.frame(0, 0, i / 37);
      for (const off of freshOffsets(s, i / 37)) expect(Math.abs(off)).toBeLessThanOrEqual(WOBBLE_LIMIT + WOBBLE_STEP);
    }
  });

  it('keeps eight pairs in the water and no more', () => {
    const s = new Spray();
    for (let i = 0; i < 200; i++) s.frame(i, 0, 0);
    expect(s.bits).toHaveLength(2 * AGES);
    expect(Math.max(...s.bits.map(b => b.age))).toBe(AGES - 1);
  });

  it('splashes a ring, and clears away', () => {
    const s = new Spray();
    s.splash(50, 50);
    expect(s.bits).toHaveLength(6);
    for (const b of s.bits) expect(Math.hypot(b.x - 50, b.y - 50)).toBeCloseTo(7, 6);
    s.clear();
    expect(s.bits).toHaveLength(0);
  });
});
