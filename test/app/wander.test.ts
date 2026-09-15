/**
 * The boat's course. The drawing needs a browser, but the course does not, and the course is where the
 * things that can actually go wrong live: leaving the hero, getting stuck in a corner, or turning so often
 * it never goes anywhere.
 */
import { describe, it, expect } from 'vitest';
import { Wander, heading, UP, RIGHT, DOWN, LEFT } from '../../src/app/landing/wander';

/** A generator with no surprises in it, so a failure here is always the same failure. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Runs the boat for `seconds` at 60 a second and hands every position to the caller. */
function sail(b: Wander, seconds: number, see: (b: Wander) => void): void {
  for (let i = 0; i < seconds * 60; i++) { b.step(1 / 60); see(b); }
}

describe('heading', () => {
  it('points up for zero and turns clockwise', () => {
    for (const [a, x, y] of [[UP, 0, -1], [RIGHT, 1, 0], [DOWN, 0, 1], [LEFT, -1, 0]] as const) {
      const d = heading(a);
      expect(d.x).toBeCloseTo(x, 9);
      expect(d.y).toBeCloseTo(y, 9);
    }
  });
});

describe('the course', () => {
  it('stays inside the water, whatever shape it is', () => {
    for (const [w, h] of [[300, 170], [96, 300], [420, 90], [40, 40]] as const) {
      const b = new Wander(w, h, { rng: rng(7) });
      sail(b, 120, () => {
        expect(b.x, `${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(w);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(h);
      });
    }
  });

  it('runs along the compass and only leaves it while turning', () => {
    const b = new Wander(300, 170, { rng: rng(3) });
    sail(b, 90, () => {
      if (b.turning) return;
      const off = Math.abs(b.a / (Math.PI / 2) - Math.round(b.a / (Math.PI / 2)));
      expect(off).toBeLessThan(1e-6);
    });
  });

  it('goes somewhere: it turns, and it uses the whole width and height', () => {
    const b = new Wander(300, 170, { rng: rng(11) });
    let turns = 0, was = b.turning;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    sail(b, 120, () => {
      if (b.turning && !was) turns++;
      was = b.turning;
      x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x);
      y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y);
    });
    expect(turns).toBeGreaterThan(8);
    expect(turns).toBeLessThan(120);              // two minutes of nothing but turning would be a spin
    expect(x1 - x0).toBeGreaterThan(150);
    expect(y1 - y0).toBeGreaterThan(80);
  });

  it('takes every direction, not just two of them', () => {
    const b = new Wander(300, 170, { rng: rng(5) });
    const seen = new Set<number>();
    sail(b, 180, () => { if (!b.turning) seen.add(Math.round(b.a / (Math.PI / 2)) % 4); });
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('survives the hero changing shape under it', () => {
    const b = new Wander(300, 170, { rng: rng(2) });
    sail(b, 5, () => undefined);
    for (const [w, h] of [[90, 260], [500, 120], [300, 170]] as const) {
      b.resize(w, h);
      sail(b, 20, () => {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(w);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(h);
      });
    }
  });

  it('does not lurch when a frame is slow', () => {
    const speed = 40;
    const slow = new Wander(300, 170, { rng: rng(9), speed });
    const start = { x: slow.x, y: slow.y };
    slow.step(4);                                 // a tab that was in the background for four seconds
    expect(Math.hypot(slow.x - start.x, slow.y - start.y)).toBeLessThan(speed * 0.25 + 1);
  });
});

describe('something in the water', () => {
  it('goes round it and never touches it', () => {
    const b = new Wander(300, 170, { rng: rng(13) });
    b.avoid.push({ x: 150, y: 85, r: 36 });
    let closest = Infinity;
    sail(b, 240, () => { closest = Math.min(closest, Math.hypot(b.x - 150, b.y - 85)); });
    expect(closest).toBeGreaterThanOrEqual(36);
  });

  it('still gets about with one in the middle', () => {
    const b = new Wander(300, 170, { rng: rng(17) });
    b.avoid.push({ x: 150, y: 85, r: 36 });
    const seen = new Set<number>();
    let x0 = Infinity, x1 = -Infinity;
    sail(b, 240, () => {
      if (!b.turning) seen.add(Math.round(b.a / (Math.PI / 2)) % 4);
      x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x);
    });
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(x1 - x0).toBeGreaterThan(150);
  });
});
