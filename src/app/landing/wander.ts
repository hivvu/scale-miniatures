/**
 * The boat's course across the hero, with no canvas in sight.
 *
 * It runs in straight lines along the four compass directions and joins them with quarter-circle turns,
 * which is what a boat does and what the brief asked for: up for a while, then right, then down. A turn is
 * an arc rather than a snap so the wake behind it bends, and so the sprite has something to rotate through.
 *
 * Everything here is whole-number maths on a plain coordinate space, x to the right and y down, measured in
 * game pixels. The page decides how big a game pixel is; this file never knows. The one source of surprise,
 * the random number generator, is injected, so a test can make the course repeat exactly.
 */

/** Facing, in radians clockwise from up, which is the direction the sprite is drawn in. */
export const UP = 0, RIGHT = Math.PI / 2, DOWN = Math.PI, LEFT = 3 * Math.PI / 2;

const QUARTER = Math.PI / 2;

export interface Course {
  /** The size of the water, in game pixels, and where the boat is on it. */
  readonly w: number;
  readonly h: number;
  readonly x: number;
  readonly y: number;
  /** Radians clockwise from up. Exactly a multiple of a quarter turn except while turning. */
  readonly a: number;
  readonly turning: boolean;
}

/** Something floating in the water that the boat is to keep clear of. `r` already includes its own beam. */
export interface Obstacle { x: number; y: number; r: number }

export interface WanderOptions {
  /** Game pixels a second. */
  speed?: number;
  /** How far the hull must stay from the edge. */
  margin?: number;
  /** Shortest and longest straight run between voluntary turns, in game pixels. */
  minRun?: number;
  maxRun?: number;
  rng?: () => number;
}

/** The unit vector for a facing: up is negative y, because y grows downwards on a screen. */
export function heading(a: number): { x: number; y: number } {
  return { x: Math.sin(a), y: -Math.cos(a) };
}

export class Wander implements Course {
  w = 0; h = 0;
  x = 0; y = 0;
  a: number = UP;

  private readonly speed: number;
  private readonly margin: number;
  private readonly minRun: number;
  private readonly maxRun: number;
  private readonly rng: () => number;

  /** Turn radius, from the size of the water: a big hero gets wide sweeping turns, a phone gets tight ones. */
  private r = 16;
  /** While turning: the centre of the arc, its radius, the direction of the turn, and how much is left. */
  private turn: { cx: number; cy: number; r: number; sign: 1 | -1; left: number } | undefined;
  /** While running straight: how much of this leg is left before it turns for no reason but variety. */
  private run = 0;
  /** Things to steer around. The page puts the duck in here; the boat then never reaches it. */
  readonly avoid: Obstacle[] = [];

  constructor(w: number, h: number, o: WanderOptions = {}) {
    this.speed = o.speed ?? 50;
    this.margin = o.margin ?? 26;
    this.minRun = o.minRun ?? 80;
    this.maxRun = o.maxRun ?? 300;
    this.rng = o.rng ?? Math.random;
    this.resize(w, h);
    this.x = this.margin + this.r + this.rng() * Math.max(1, w - 2 * (this.margin + this.r));
    this.y = h - this.margin - this.r;
    this.run = this.newRun();
  }

  get turning(): boolean { return this.turn !== undefined; }

  /**
   * The water changed shape. Keep the boat inside it and stop any turn in progress, because the arc it was
   * following was measured against the old edges and may now go through one.
   */
  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    // A turn has to fit twice over in each direction, or the boat spends its life turning.
    this.r = Math.max(6, Math.min(40, Math.min(this.w, this.h) / 5));
    this.turn = undefined;
    this.a = Math.round(this.a / QUARTER) * QUARTER;
    this.x = Math.min(Math.max(this.x, this.margin), this.w - this.margin);
    this.y = Math.min(Math.max(this.y, this.margin), this.h - this.margin);
    this.run = Math.min(this.run, this.clearance(this.x, this.y, this.a));
  }

  /** One step of `dt` seconds. */
  step(dt: number): void {
    let move = this.speed * Math.min(dt, 0.25);        // a backgrounded tab must not teleport it
    while (move > 1e-6) move = this.turn ? this.stepTurn(move) : this.stepStraight(move);
    // Belt and braces. The course is planned to stay inside, but a resize mid-turn can leave the boat with
    // nowhere good to go, and a boat drawn over the edge of the hero is worse than one that hugs it.
    this.x = Math.min(Math.max(this.x, this.margin), this.w - this.margin);
    this.y = Math.min(Math.max(this.y, this.margin), this.h - this.margin);
  }

  /** Follows the arc, and returns whatever distance was left over after finishing it. */
  private stepTurn(move: number): number {
    const t = this.turn!;
    const phi = Math.min(move / t.r, t.left);
    const c = Math.cos(t.sign * phi), s = Math.sin(t.sign * phi);
    const dx = this.x - t.cx, dy = this.y - t.cy;
    this.x = t.cx + dx * c - dy * s;                   // y grows downwards, so this rotation reads clockwise
    this.y = t.cy + dx * s + dy * c;
    this.a = norm(this.a + t.sign * phi);
    t.left -= phi;
    if (t.left > 1e-9) return 0;
    this.a = norm(Math.round(this.a / QUARTER) * QUARTER);
    this.turn = undefined;
    this.run = this.newRun();
    return move - phi * t.r;
  }

  /** Runs straight until the leg ends or the far edge gets close, then sets up the turn. */
  private stepStraight(move: number): number {
    const d = heading(this.a);
    // Stop with enough water left to get the whole arc in: the turn needs a radius of room ahead of it.
    const room = Math.max(0, this.clearance(this.x, this.y, this.a) - this.r);
    const go = Math.min(move, this.run, room);
    this.x += d.x * go;
    this.y += d.y * go;
    this.run -= go;
    // Turn because the leg is over, or because the edge is now exactly one turn away.
    if (this.run <= 1e-6 || room - go <= 1e-6) this.beginTurn();
    return move - go;
  }

  /**
   * Picks a side to turn towards: at random between two that fit. When neither does, and that happens when
   * something has appeared in the water right in front, it tries again with a tighter wheel before falling
   * back on the roomier of the two.
   */
  private beginTurn(): void {
    let wide: { cx: number; cy: number; r: number; sign: 1 | -1 } | undefined;
    for (const r of [this.r, this.r * 0.6, this.r * 0.32]) {
      const options = ([1, -1] as const).map(sign => {
        const d = heading(this.a);
        // The centre of the arc sits one radius off the beam, to the right of the boat or to its left.
        const cx = this.x + sign * -d.y * r, cy = this.y + sign * d.x * r;
        const ex = cx + sign * -(this.y - cy), ey = cy + sign * (this.x - cx);
        const ea = norm(this.a + sign * QUARTER);
        return { sign, cx, cy, r, fits: this.arcClear(cx, cy, r, sign), after: this.clearance(ex, ey, ea) };
      });
      wide ??= options[0]!.after >= options[1]!.after ? options[0]! : options[1]!;
      const fits = options.filter(o => o.fits && o.after >= this.minRun);
      const any = fits.length > 0 ? fits : options.filter(o => o.fits);
      if (any.length > 0) {
        const pick = any[Math.min(any.length - 1, Math.floor(this.rng() * any.length))]!;
        this.turn = { cx: pick.cx, cy: pick.cy, r: pick.r, sign: pick.sign, left: QUARTER };
        return;
      }
    }
    this.turn = { cx: wide!.cx, cy: wide!.cy, r: wide!.r, sign: wide!.sign, left: QUARTER };
  }

  /** How far the boat can go from a point in a direction before it reaches the margin, or something in it. */
  private clearance(x: number, y: number, a: number): number {
    const d = heading(a);
    let far = Math.abs(d.x) > Math.abs(d.y)
      ? (d.x > 0 ? this.w - this.margin - x : x - this.margin)
      : (d.y > 0 ? this.h - this.margin - y : y - this.margin);
    for (const o of this.avoid) {
      const ox = o.x - x, oy = o.y - y;
      const ahead = ox * d.x + oy * d.y, beam = Math.abs(ox * -d.y + oy * d.x);
      if (ahead > 0 && beam < o.r) far = Math.min(far, ahead - o.r);
    }
    return Math.max(0, far);
  }

  /** Whether the whole quarter circle stays in the water and misses everything floating in it. */
  private arcClear(cx: number, cy: number, r: number, sign: 1 | -1): boolean {
    const vx = this.x - cx, vy = this.y - cy;
    for (let i = 1; i <= 8; i++) {
      const phi = sign * QUARTER * i / 8;
      const c = Math.cos(phi), s = Math.sin(phi);
      if (!this.inside(cx + vx * c - vy * s, cy + vx * s + vy * c)) return false;
    }
    return true;
  }

  private inside(x: number, y: number): boolean {
    if (x < this.margin || x > this.w - this.margin || y < this.margin || y > this.h - this.margin) return false;
    return !this.avoid.some(o => Math.hypot(o.x - x, o.y - y) < o.r);
  }

  private newRun(): number {
    return this.minRun + this.rng() * (this.maxRun - this.minRun);
  }
}

function norm(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}
