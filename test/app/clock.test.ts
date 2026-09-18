/**
 * The race clock, which has one job: never stop.
 *
 * Driving a game from `requestAnimationFrame` alone means the game stops the moment the browser decides
 * this page cannot be seen, and in a race with other people that stops their race too, because nobody can
 * take a step without everybody's input. These tests are the frames drying up and coming back.
 */
import { describe, it, expect } from 'vitest';
import { startClock, type ClockEnv } from '../../src/app/online/clock';

/** A browser whose frames and timers only happen when this test says so. */
function fake() {
  let t = 0;
  let frame: ((n: number) => void) | undefined;
  let framesOn = true;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  let ids = 0;
  const env: ClockEnv = {
    raf: cb => { if (framesOn) frame = cb; return ++ids; },
    cancel: () => { /* the next raf replaces it anyway */ },
    now: () => t,
    every: (fn, ms) => { const id = ++ids; timers.set(id, { fn, ms, next: t + ms }); return id; },
    stopEvery: id => { timers.delete(id); },
  };
  return {
    env,
    get framesOn(): boolean { return framesOn; },
    set framesOn(v: boolean) { framesOn = v; },
    /** Moves time on, delivering one frame per 16 ms and firing any interval that comes due. */
    advance(ms: number, withFrames = true): void {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + 16);
        for (const timer of timers.values()) {
          while (t >= timer.next) { timer.next += timer.ms; timer.fn(); }
        }
        if (withFrames && framesOn && frame) { const f = frame; frame = undefined; f(t); }
      }
    },
  };
}

describe('the race clock', () => {
  it('ticks once a frame while the frames come', () => {
    const f = fake();
    const at: number[] = [];
    startClock(n => { at.push(n); }, f.env);
    f.advance(160);
    expect(at).toHaveLength(10);                     // ten frames of 16 ms, and not one extra
  });

  it('carries on when the browser stops handing out frames', () => {
    const f = fake();
    const at: number[] = [];
    startClock(n => { at.push(n); }, f.env);
    f.advance(160);
    const beforeSilence = at.length;
    f.framesOn = false;
    f.advance(2000);
    expect(at.length).toBeGreaterThan(beforeSilence);       // it did not stop
    // Roughly three a second: it looks every 80 ms and gives up waiting for a frame after 250.
    const kicks = at.length - beforeSilence;
    expect(kicks).toBeGreaterThanOrEqual(4);
    expect(kicks).toBeLessThanOrEqual(9);
  });

  it('goes back to the frames when they return, without ticking twice', () => {
    const f = fake();
    const at: number[] = [];
    startClock(n => { at.push(n); }, f.env);
    f.framesOn = false;
    f.advance(1000);
    const onTimer = at.length;
    f.framesOn = true;
    f.advance(320);
    // 20 frames, and the watchdog quiet throughout because a frame lands every 16 ms
    expect(at.length - onTimer).toBe(20);
  });

  it('stops when it is told to, and when the tick says so', () => {
    const f = fake();
    const at: number[] = [];
    const c = startClock(n => { at.push(n); }, f.env);
    f.advance(64);
    c.stop();
    f.advance(2000);
    expect(at).toHaveLength(4);

    const g = fake();
    const seen: number[] = [];
    startClock(n => { seen.push(n); return seen.length < 3; }, g.env);
    g.advance(2000);
    expect(seen).toHaveLength(3);
  });
});
