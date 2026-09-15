/**
 * The boat that wanders the hero, and the duck that sometimes turns up on it.
 *
 * The course is in `wander.ts` and the wake is in `spray.ts`; this file is the drawing, and it is drawn the
 * way the game draws: on a grid of whole game pixels, never smoothed, at the game's own frame rate, with
 * the sprite pre-rotated into sixteen frames at its own resolution rather than the canvas rotating a
 * blown-up copy. That last part is what the original does too, and it is the difference between pixel art
 * that turns and pixel art that goes soft every time it is not square on.
 *
 * The foam images are the one thing that is not from the game: the originals live in BITSFILE.PH0 and are
 * Codemasters', so the ring that expands and breaks up is drawn here in code, following the shape theirs
 * has, in the page's blue rather than the bathwater's.
 */
import { Wander, heading } from './wander';
import { Spray, AGES } from './spray';

/** One game pixel, in CSS pixels. The boat sprite is 12x24, so this decides how big it all looks. */
const PX = 2.5;
const PX_SMALL = 1.5;
/** Side of one pre-rotated sprite frame: the sprite's diagonal, rounded up to something even. */
const FRAME = 28;
const FRAMES = 16;

/** The race renders at about this, and everything below is counted in its frames rather than in seconds. */
const GAME_FPS = 35;
const STEP = 1 / GAME_FPS;

/** How one bit of foam grows and thins out over its eight images, following the shapes in the game's. */
const FOAM_R_BY_AGE = [0.7, 1.5, 2.2, 2.7, 3.1, 3.4, 3.6, 3.7];
const FOAM_KEEP_BY_AGE = [1, 1, 0.9, 0.8, 0.62, 0.45, 0.3, 0.2];
const FOAM_LIT_BY_AGE = [1, 1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.1];
const FOAM_LIT = '#FFFFFF';
const FOAM_DIM = '#8FD5F2';

/**
 * How wide the duck wants to be, in game pixels. Its sprite is far more detailed than the boat's, so it is
 * not squeezed onto the same grid: it is blown up by a whole number of device pixels per sprite pixel, which
 * keeps every one of them square, and that lands near this rather than exactly on it.
 */
const DUCK_WANTS = 76;
/** How much open water there has to be between the boat and a new duck, so neither is ever committed at it. */
const DUCK_CLEAR = 110;
const DUCK_TRIES = 40;
/** Not every visit gets one. That is the point of it, but most visits should. */
const DUCK_CHANCE = 0.85;

interface Rect { x: number; y: number; w: number; h: number }

function make(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

/** A stable hash, so the foam breaks up the same way on every machine and on every visit. */
function hash(x: number, y: number, f: number): number {
  let v = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(f, 2246822519);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 16) / 0x10000;
}

/** The eight images of one bit of foam: a blob that opens into a ring and then comes apart. */
function foamFrames(): HTMLCanvasElement {
  const strip = make(8 * AGES, 8);
  const ctx = strip.getContext('2d')!;
  for (let f = 0; f < AGES; f++) {
    const r = FOAM_R_BY_AGE[f]!, keep = FOAM_KEEP_BY_AGE[f]!, lit = FOAM_LIT_BY_AGE[f]!;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
        const on = f === 0 ? d <= r + 0.5 : Math.abs(d - r) <= 0.85;
        if (!on || hash(x, y, f) > keep) continue;
        ctx.fillStyle = hash(x, y, f + 64) < lit ? FOAM_LIT : FOAM_DIM;
        ctx.fillRect(f * 8 + x, y, 1, 1);
      }
    }
  }
  return strip;
}

/**
 * The sprite turned into `FRAMES` frames, one every 22.5 degrees, each at the sprite's own resolution.
 * Nearest neighbour on purpose: a rotated pixel is still a pixel.
 */
function rotateFrames(img: HTMLImageElement): HTMLCanvasElement {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const src = make(sw, sh);
  const sctx = src.getContext('2d')!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(img, 0, 0);
  const s = sctx.getImageData(0, 0, sw, sh).data;

  const strip = make(FRAME * FRAMES, FRAME);
  const dctx = strip.getContext('2d')!;
  for (let f = 0; f < FRAMES; f++) {
    const a = f * 2 * Math.PI / FRAMES;
    const cos = Math.cos(a), sin = Math.sin(a);
    const out = dctx.createImageData(FRAME, FRAME);
    for (let dy = 0; dy < FRAME; dy++) {
      for (let dx = 0; dx < FRAME; dx++) {
        // Undo the turn to find which pixel of the upright sprite lands here.
        const ox = dx + 0.5 - FRAME / 2, oy = dy + 0.5 - FRAME / 2;
        const sx = Math.floor(sw / 2 + ox * cos + oy * sin);
        const sy = Math.floor(sh / 2 - ox * sin + oy * cos);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const si = (sy * sw + sx) * 4, di = (dy * FRAME + dx) * 4;
        out.data[di] = s[si]!; out.data[di + 1] = s[si + 1]!;
        out.data[di + 2] = s[si + 2]!; out.data[di + 3] = s[si + 3]!;
      }
    }
    dctx.putImageData(out, f * FRAME, 0);
  }
  return strip;
}

export function startHero(hero: HTMLElement, canvas: HTMLCanvasElement, boatSrc: string, duckSrc: string): void {
  const maybe = canvas.getContext('2d');
  if (!maybe) return;
  const ctx: CanvasRenderingContext2D = maybe;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const foam = foamFrames();
  const spray = new Spray();

  let strip: HTMLCanvasElement | undefined;
  let duckImg: HTMLImageElement | undefined;
  let gw = 0, gh = 0, scale = 1;
  let boat: Wander | undefined;

  let duck: { x: number; y: number } | undefined;
  /** The duck as drawn: whole device pixels per sprite pixel, and what that comes to in game pixels. */
  let duckZoom = 1, duckSize = DUCK_WANTS;
  let duckIn = Math.random() < DUCK_CHANCE ? Math.round((2 + Math.random() * 4) * GAME_FPS) : Infinity;
  /** Where the page's own words and pictures are, in game pixels: a duck never surfaces under them. */
  let taken: Rect[] = [];

  let ticks = 0;
  let frame = 0;
  let last = 0;
  let spare = 0;
  let onScreen = true;

  function measure(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = hero.clientWidth, h = hero.clientHeight;
    if (w === 0 || h === 0) return;
    const was = { w: gw, h: gh };
    // Whole device pixels per game pixel, or the grid shimmers as the sprite moves across it.
    scale = Math.max(2, Math.round((w < 640 ? PX_SMALL : PX) * dpr));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gw = Math.ceil(canvas.width / scale);
    gh = Math.ceil(canvas.height / scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (boat) boat.resize(gw, gh); else boat = new Wander(gw, gh);
    spray.clear();

    const src = duckImg?.naturalWidth ?? 63;
    duckZoom = Math.max(1, Math.floor(Math.min(DUCK_WANTS, gw * 0.22) * scale / src + 0.25));
    duckSize = src * duckZoom / scale;

    const box = hero.getBoundingClientRect();
    const g = dpr / scale;
    taken = [...hero.querySelectorAll('.wrap > *'), ...hero.querySelectorAll('.chequer')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - box.left) * g, y: (r.top - box.top) * g, w: r.width * g, h: r.height * g };
    });

    // The hero changed shape, so carry the duck across in proportion, and find it somewhere else if that
    // has put it under the logo.
    if (duck && was.w > 0) {
      const moved = { x: duck.x * gw / was.w, y: duck.y * gh / was.h };
      place(clear(moved.x, moved.y) ? moved : openWater() ?? moved);
    }
  }

  /** How wide a berth the boat gives the duck: half of each of them, and a little politeness. */
  function room(): number { return duckSize / 2 + 15; }

  /** Whether a duck centred here would be in open water, clear of everything the page has put on top. */
  function clear(x: number, y: number): boolean {
    const half = duckSize / 2 + 2;
    if (x < half || x > gw - half || y < half || y > gh - half) return false;
    return !taken.some(r => x + half > r.x && x - half < r.x + r.w && y + half > r.y && y - half < r.y + r.h);
  }

  /** Somewhere the boat is not, is not heading, and the page is not already using. */
  function openWater(): { x: number; y: number } | undefined {
    if (!boat || boat.turning) return undefined;      // mid-turn the boat is committed, so wait for the straight
    const d = heading(boat.a);
    for (let i = 0; i < DUCK_TRIES; i++) {
      const x = Math.random() * gw, y = Math.random() * gh;
      if (!clear(x, y)) continue;
      const ox = x - boat.x, oy = y - boat.y;
      if (Math.hypot(ox, oy) < DUCK_CLEAR) continue;
      // Straight ahead of the boat is not open water, however far away it looks right now.
      const ahead = ox * d.x + oy * d.y, beam = Math.abs(ox * -d.y + oy * d.x);
      if (ahead > 0 && beam < room() * 2) continue;
      return { x: Math.round(x), y: Math.round(y) };
    }
    return undefined;                                 // a crowded hero simply gets no duck this time
  }

  /** Puts the duck down and tells the boat it is there, so the course goes round it from now on. */
  function place(at: { x: number; y: number }): void {
    duck = { x: Math.round(at.x), y: Math.round(at.y) };
    if (boat) {
      boat.avoid.length = 0;
      boat.avoid.push({ x: duck.x, y: duck.y, r: room() });
    }
  }

  /** One frame of the game's clock. */
  function step(): void {
    ticks++;
    if (!boat) return;
    boat.step(STEP);
    spray.frame(boat.x, boat.y, boat.a);
    if (duck || --duckIn > 0) return;
    const at = openWater();
    if (at) { place(at); spray.splash(at.x, at.y); }
    else duckIn = Math.round((1 + Math.random() * 2) * GAME_FPS);    // mid-turn or crowded: try again shortly
  }

  function draw(): void {
    if (!boat) return;
    ctx.clearRect(0, 0, gw, gh);

    for (const p of spray.bits) {
      ctx.drawImage(foam, p.age * 8, 0, 8, 8, Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8);
    }

    if (duck && duckImg) {
      // Drawn straight in device pixels, off the game-pixel grid, so its own pixels stay whole and square.
      const bob = Math.round(Math.sin(ticks / 11));          // it sits on water, so it moves with it
      const side = duckImg.naturalWidth * duckZoom;
      const cx = duck.x * scale, cy = (duck.y + bob) * scale;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(duckImg, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side);
      ctx.restore();
    }

    if (strip) {
      const f = (Math.round(boat.a / (2 * Math.PI) * FRAMES) % FRAMES + FRAMES) % FRAMES;
      ctx.drawImage(strip, f * FRAME, 0, FRAME, FRAME,
                    Math.round(boat.x) - FRAME / 2, Math.round(boat.y) - FRAME / 2, FRAME, FRAME);
    }
  }

  function tick(now: number): void {
    frame = 0;
    const dt = last === 0 ? 0 : Math.min(0.25, (now - last) / 1000);
    last = now;
    spare += dt;
    let moved = dt === 0;
    while (spare >= STEP) { spare -= STEP; step(); moved = true; }
    if (moved) draw();
    if (onScreen && !document.hidden && !still.matches) frame = requestAnimationFrame(tick);
  }

  function run(): void {
    if (frame !== 0 || !strip) return;
    last = 0; spare = 0;
    if (still.matches) { draw(); return; }
    frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  }

  const boatImg = new Image();
  boatImg.decoding = 'async';
  boatImg.addEventListener('load', () => {
    strip = rotateFrames(boatImg);
    measure();
    run();
  });
  boatImg.addEventListener('error', () => { canvas.remove(); });
  boatImg.src = boatSrc;

  // The duck is optional scenery: if it does not arrive, the boat sails on without it.
  const d = new Image();
  d.decoding = 'async';
  d.addEventListener('load', () => { duckImg = d; measure(); });
  d.addEventListener('error', () => { duckIn = Infinity; });
  d.src = duckSrc;

  // Stop while the hero is off screen: below it is a game that wants every frame it can get.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => {
      onScreen = es.some(e => e.isIntersecting);
      if (onScreen) run(); else stop();
    }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else run(); });
  still.addEventListener('change', () => { stop(); run(); });
  if ('ResizeObserver' in window) {
    let pending = 0;
    new ResizeObserver(() => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => { if (strip) { measure(); run(); } }, 120);
    }).observe(hero);
  }
}
