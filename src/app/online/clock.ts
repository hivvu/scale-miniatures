/**
 * The clock a race runs on, and a second one watching it.
 *
 * `requestAnimationFrame` is the right way to drive a game and the wrong thing to depend on: a browser
 * stops handing out frames whenever it feels the page cannot be seen, and going full screen, hiding the
 * window or putting another tab in front all do it. On one machine that is a paused game and no harm done.
 * Online it is worse than that, because the others cannot advance a step without this machine's input, so
 * one person going full screen would leave everybody standing still.
 *
 * So the frames drive it while they come, and a timer takes over when they stop. The timer does not live
 * on the page: a hidden page's `setInterval` is clamped to about once a second, which turns a stopped race
 * into a crawling one, and the crawl is everybody's and not just this machine's. A dedicated worker's
 * timer is not clamped that way, so the worker keeps the beat and the page follows it.
 *
 * Without workers, or if one cannot be made, it falls back to `setInterval` and the crawl, which is still
 * better than stopping.
 *
 * Everything it touches is injected, which is why it can be tested rather than argued about.
 */
export interface Clock { stop(): void }

export interface ClockEnv {
  raf(cb: (t: number) => void): number;
  cancel(id: number): void;
  now(): number;
  every(fn: () => void, ms: number): number;
  stopEvery(id: number): void;
}

/**
 * A beat from a worker, which a browser does not slow down when the page goes behind another window.
 * Returns undefined when workers are not available, or when making one fails.
 */
function workerBeat(fn: () => void, ms: number): (() => void) | undefined {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  try {
    const src = `let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => { fn(); };
    worker.postMessage(ms);
    return () => { worker.postMessage(0); worker.terminate(); };
  } catch { return undefined; }
}

const stoppers = new Map<number, () => void>();
let nextId = 1;

const browser: ClockEnv = {
  raf: cb => requestAnimationFrame(cb),
  cancel: id => { cancelAnimationFrame(id); },
  now: () => performance.now(),
  every: (fn, ms) => {
    const id = nextId++;
    const beat = workerBeat(fn, ms);
    if (beat) stoppers.set(id, beat);
    else { const t = setInterval(fn, ms); stoppers.set(id, () => { clearInterval(t); }); }
    return id;
  },
  stopEvery: id => { stoppers.get(id)?.(); stoppers.delete(id); },
};

/**
 * Calls `tick` on every frame, and at least every `quiet` milliseconds whether frames arrive or not.
 * `tick` returning false ends it, as does `stop`.
 */
export function startClock(tick: (now: number) => boolean | void, env: ClockEnv = browser,
                           quiet = 250, check = 80): Clock {
  let ended = false;
  let raf = 0;
  let last = env.now();

  const run = (now: number): void => {
    if (ended) return;
    last = now;
    if (tick(now) === false) { ended = true; env.stopEvery(watch); env.cancel(raf); return; }
    env.cancel(raf);
    raf = env.raf(run);
  };

  const watch = env.every(() => {
    const now = env.now();
    if (ended || now - last < quiet) return;
    run(now);
  }, check);

  raf = env.raf(run);
  return {
    stop(): void {
      if (ended) return;
      ended = true;
      env.stopEvery(watch);
      env.cancel(raf);
    },
  };
}
