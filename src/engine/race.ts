/**
 * Race logic step: transliteration of the fn 3039 loop body of MICRO_U.EXE (2d5b input, 4aee physics, the render
 * pass side effects of 90c5, and 7429/73e7/51b2 per car). Mirrors tools/mm/sim/race.py routine for routine;
 * addresses are relative to CS=1000 of the Ghidra project. See re/notes/70-physics.md and 80-ai-collision.md.
 */
import { DataSegment, NotImplementedYet, mulfix, s16, s8 } from './memory';
import { DOS_VIEWPORT, type Viewport } from './viewport';
import type { SoundPort } from './sound/port';

export const CARS = [0, 0x164, 0x2C8, 0x42C] as const;

/**
 * The two analogue devices the game reads itself: the game port at 201h (fn 2f9e/2fcc/2ffe) and the mouse
 * driver (int 33h). The page supplies them; without one the stick sits centred and no button is down.
 */
export interface AnalogueDevices {
  /** fn 2ffe: the four axis counts, and the raw port byte whose top four bits are the buttons, active low
   *  (bit 4 = stick A button 1, 5 = A button 2, 6 = B button 1, 7 = B button 2). */
  joysticks(): { ax: number; ay: number; bx: number; by: number; port: number };
  /** int 33h fn 3: the button mask (bit 0 left, bit 1 right) and the pointer in 320x200 coordinates. */
  mouse(): { buttons: number; x: number; y: number };
  /** int 33h fn 4: fn 2e02 puts the pointer back in the middle after every frame that moved it. */
  warpMouse(x: number, y: number): void;
}

/** What fn 2f9e reads with no stick plugged in: the port answers at once, so every count is 0. */
export const STICK_CENTRED = { ax: 0, ay: 0, bx: 0, by: 0, port: 0xFF } as const;

/**
 * fn 2e6c: joystick A. The X axis steers against the two thresholds the calibration screen worked out;
 * the buttons accelerate (button 2), brake (button 1) and either one fires. The Y axis is read into
 * [108f] and compared against [2901]/[2903], but both comparisons throw their flags away before anything
 * uses them, so the stick's up and down do nothing at all. Kept exactly as the original has it.
 */
function joystickA(d: DataSegment): number {
  let al = 0;
  const ah = d.r8(0x1095) & 0x30;
  if (ah !== 0) al = 8;
  const x = s16(d.r16(0x108D));
  if (!(x > s16(d.r16(0x28FD)))) al |= 0x80;
  if (!(x < s16(d.r16(0x28FF)))) al |= 0x40;
  if (ah === 0x20) al |= 0x20;
  if (ah === 0x10) al |= 0x10;
  if (ah === 0x30) al |= 0x30;
  return al;
}

/** fn 2eb3: joystick B, the same routine over the other two axes and the other pair of buttons. */
function joystickB(d: DataSegment): number {
  let al = 0;
  const ah = (d.r8(0x1095) >> 2) & 0x30;
  if (ah !== 0) al = 8;
  const x = s16(d.r16(0x1091));
  if (!(x > s16(d.r16(0x2905)))) al |= 0x80;
  if (!(x < s16(d.r16(0x2907)))) al |= 0x40;
  if (ah === 0x20) al |= 0x20;
  if (ah === 0x10) al |= 0x10;
  if (ah === 0x30) al |= 0x30;
  return al;
}

/**
 * fn 2e02: the mouse. The left button accelerates and fires, the right one brakes, and the pointer's
 * distance from the middle of the screen steers; any movement at all recentres it, so the driver is
 * always reporting the last frame's movement.
 */
function mouseInput(d: DataSegment, dev: AnalogueDevices): number {
  const m = dev.mouse();
  let si = 0;
  if (m.buttons & 1) si |= 0x28;
  if (m.buttons & 2) si |= 0x10;
  const dz = s16(d.r16(0x290D));
  if (s16(m.x) <= 0xA0 - dz) si |= 0x80;
  else if (s16(m.x) >= 0xA0 + dz) si |= 0x40;
  if (s16(m.y) <= 0x64 - dz) si |= 0x20;
  else if (s16(m.y) >= 0x64 + dz) si |= 0x10;
  if (si & 0xF0) dev.warpMouse(0xA0, 0x64);
  return si & 0xFF;
}

/**
 * fn 2d5b: one input byte per car, taken from the source word at [2658+n*2] (4 and 5 are the two halves of
 * the keyboard, 1..3 joystick and mouse, anything else the AI), then the byte the menus and cheats read at
 * [108b]: both players together, or the one car [1080] points at.
 *
 * The head of the routine reads the game port once per frame, for whichever sticks fn 2d00 found in use
 * ([108c] bit 0 = A, bit 1 = B), and leaves the counts in [108d..1094] and the inverted buttons in [1095].
 */
export function pollInput(d: DataSegment, ai?: (bx: number) => number, dev?: AnalogueDevices): void {
  const used = d.r8(0x108C);
  if (used === 1 || used === 2 || used === 3) {
    const j = dev ? dev.joysticks() : STICK_CENTRED;
    if (used !== 2) { d.w16(0x108D, j.ax); d.w16(0x108F, j.ay); }
    if (used !== 1) { d.w16(0x1091, j.bx); d.w16(0x1093, j.by); }
    d.w8(0x1095, ~j.port & 0xFF);
  }
  const keys1 = d.r8(0x107D), keys2 = d.r8(0x107C);
  CARS.forEach((bx, i) => {
    const src = d.r16(0x2658 + i * 2);
    let al: number;
    if (src === 4) al = keys1;
    else if (src === 5) al = keys2;
    else if (src === 1) al = joystickA(d);
    else if (src === 2) al = joystickB(d);
    else if (src === 3) al = dev ? mouseInput(d, dev) : 0;
    else { al = 0; if (ai && d.r8(0x1082) !== 0) al = ai(bx); }
    d.w8(0x137B + bx, al);
  });
  if (d.r16(0x1080) === 0) d.w8(0x108B, d.r8(0x137B) | d.r8(0x14DF));
  else d.w8(0x108B, d.r8(d.r16(0x1080)));
}

export interface SoundCall { fn: number; arg: number; }

export class Race {
  readonly sounds: SoundCall[] = [];
  /** Set by the page when there is a sound device: fn 7b46 talks to it every displayed frame. */
  sound?: SoundPort;
  /** Set by the page when a car is driven by a joystick or the mouse (fn 2d5b reads them itself). */
  devices?: AnalogueDevices;
  /** What fn 851f / 855a / 8634 want drawn this frame (head to head only); read by RaceRenderer.banners. */
  banner: { src: number; x: number; y: number } | undefined;
  /** fn 35f0: 0 = racing, 1 = the Paused! banner is up, 2 = waiting for a key, 3 = the debug keys. */
  pauseStage = 0;
  /** A CHEATS.BIN spot was applied: the page flashes the viewport white for one frame (3734). */
  pauseFlash = false;
  /** 3798: the page owes one more render pass before the pause goes on. */
  pauseRender = false;
  /** fn 7cae: three overlapping words in the code segment, so a write to one changes the next. */
  private readonly seed = new Uint8Array([0x45, 0x23, 0x56, 0x26]);
  constructor(readonly d: DataSegment, readonly vp: Viewport = DOS_VIEWPORT) {}

  /** fn 7cae: the game's random number generator. */
  random(): number {
    const rd = (o: number): number => this.seed[o]! | (this.seed[o + 1]! << 8);
    const wr = (o: number, v: number): void => { this.seed[o] = v & 0xFF; this.seed[o + 1] = (v >> 8) & 0xFF; };
    let ax = ((rd(0) ^ 0x0234) + 0x2244);
    let carry = ax > 0xFFFF ? 1 : 0;
    wr(0, ax);
    ax = rd(1) + rd(0) + carry;
    carry = ax > 0xFFFF ? 1 : 0;
    wr(1, ax ^ 0x22AB);
    ax = rd(2) + 0x233 + carry;
    wr(2, ax ^ 0x5345);
    return rd(2);
  }

  /**
   * fn 7b46: the engine note of every car, once per displayed frame. The pitch is the car's speed over ten,
   * higher in the air, fixed while it reappears and almost silent when the car is not on screen, plus a
   * couple of steps of jitter. Only the AdLib driver has engine notes.
   */
  private engineSound(): void {
    const d = this.d;
    if (d.r16(0x0F64) !== 1) return;
    for (const bx of CARS) if (d.r16(bx + 0x12AE) === 0x0B) return;
    const cars = d.r16(0x2656) === 2 ? 2 : 4;
    for (let car = 0; car < cars; car++) {
      const bx = CARS[car]!;
      let cx = Math.abs(d.rs16(bx + 0x127A));
      if (cx >= 0x800) cx = 0x7FF;
      cx = Math.floor(cx / 10);
      if (d.r16(bx + 0x12D4) !== 0) cx += 0x30;
      if (d.r16(bx + 0x1382) !== 0) cx = 0x14;
      if (d.r16(bx + 0x1250) === 0) cx = 0x0A;
      cx = cx + (this.random() & 3) - 2;
      if (cx < 0) cx = -cx;
      const pitch = cx & 0xFF;
      this.sound?.engine(car, pitch, pitch !== 0);
    }
  }

  // ---------------------------------------------------------------- helpers
  get round(): number { return this.d.r8(0x28BF); }
  private snd(fn: number, arg: number): void { this.sounds.push({ fn, arg }); }

  wrapPos(v: number): number {
    v = s16(v);
    if (v <= -1) v += 0xC00;
    if (v >= 0xC00) v -= 0xC00;
    return v & 0xFFFF;
  }

  /** x' = x + hi8(vx + fx) ; fx' = lo8 (fn 5532 / 5960 / 5be7 prologue), wrapped to 0..0xBFF. */
  candidate(bx: number): void {
    const d = this.d;
    let ax = (d.r16(bx + 0x1272) + d.r16(bx + 0x1258)) & 0xFFFF;
    d.w16(bx + 0x125E, this.wrapPos(s8(ax >> 8) + d.rs16(bx + 0x125C)));
    d.w16(bx + 0x125A, ax & 0xFF);
    ax = (d.r16(bx + 0x1276) + d.r16(bx + 0x1264)) & 0xFFFF;
    d.w16(bx + 0x126A, this.wrapPos(s8(ax >> 8) + d.rs16(bx + 0x1268)));
    d.w16(bx + 0x1266, ax & 0xFF);
  }

  /** fn 4aee / 525e prologue: [262f] = 1 when this (non-leading) car is off-screen and listed in [2678..[267e]]. */
  catchupFlag(bx: number): number {
    const d = this.d;
    let cl = 0;
    if (bx !== 0 && d.r16(bx + 0x1250) === 0) {
      let si = 0x2678;
      for (;;) {
        const ax = d.r16(si); si += 2;
        if (ax === bx) break;
        if (ax === 0) { cl = 1; break; }
        // quirk: si is an offset and [267e] holds a value, so this compares a pointer against a score and
        // leaves the loop after two entries. That is what the original does; confirmed against race.py.
        if (si > d.r16(0x267E)) break;
      }
    }
    d.w8(0x262F, cl);
    return cl;
  }

  respawn(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x12BA, d.r16(bx + 0x125C)); d.w16(bx + 0x12BC, d.r16(bx + 0x1268));
    d.w16(bx + 0x12AE, 0x0D);
  }

  // ---------------------------------------------------------------- input (fn 2d5b / 5429)
  fn5429Ai(bx: number): number {
    const d = this.d;
    d.w8(bx + 0x137B, 0);
    let ax = d.r16(bx + 0x12DA); const dx = d.r16(bx + 0x12DE); let cx = d.r8(bx + 0x12E0);
    if (this.round === 2) ax &= 7;
    ax &= 0xF;
    if (dx & 2) { cx = (cx >> 5) & 3; ax = d.r8(0x191B + cx * 16 + ax); }
    ax = d.r16(0x18FB + ax * 2);
    if (dx & 1) ax ^= 0x80;
    const al = s8((ax - d.r16(bx + 0x1278)) & 0xFF);
    if (al < 0) d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x80);
    else if (al >= 3) d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x40);
    const brk = d.r8(d.r16(0x28BB) + d.r16(bx + 0x12E3));
    const mode = brk >> 4;
    const full = (): void => { d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20); d.w16(bx + 0x129C, d.r16(bx + 0x129E)); };
    const targetSpeed = (): void => {
      let a = (((brk & 0xF) << 8) >> 1) + 0x380;
      if (d.r8(0x28C1) === 0x17) a += 0x50;
      if (this.round === 7) { if (d.r8(0x28C1) >= 0x13) a -= 0x20; a -= 0xD0; }
      if (d.rs16(bx + 0x127A) > s16(a)) d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x10);
      else d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20);
      d.w16(bx + 0x129C, d.r16(bx + 0x129E));
    };
    if (mode === 0) full();
    else if (mode === 1) targetSpeed();
    else if (mode === 2) {
      const a = (((brk & 0xF) << 8) >> 2) + 0x600;
      d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20);
      if (d.rs16(bx + 0x129C) <= s16(a)) d.w16(bx + 0x129C, a);
    } else if (d.r8(bx + 0x137B) & 0xC0) targetSpeed();
    else full();
    d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 8);
    return d.r8(bx + 0x137B);
  }

  /** Per-step input poll. keys1/keys2 = the two keyboard input bytes ([107d]/[107c]). */
  fn2d5bInput(keys1: number, keys2 = 0): void {
    this.d.w8(0x107D, keys1); this.d.w8(0x107C, keys2);
    pollInput(this.d, bx => this.fn5429Ai(bx), this.devices);
  }

  // ---------------------------------------------------------------- fn 4aee physics
  fn4edcSteerRate(bx: number): number {
    const d = this.d;
    let cx = d.r16(bx + 0x129A);
    if (this.round === 7) {
      if (d.r16(bx + 0x12EB) === 1) return (cx + 1) & 0xFFFF;
      if (d.rs16(bx + 0x127A) >= 0x320) cx = (s16(cx) >> 1) & 0xFFFF;
    }
    return cx;
  }

  fn4aee(): void {
    const d = this.d;
    for (const bx of CARS) this.carControl(bx);
    for (const p of [0x2660, 0x2662, 0x2664, 0x2666]) this.fn525eMove(d.r16(p));
    this.fn5921Collisions();
    for (const p of [0x2660, 0x2662, 0x2664, 0x2666]) this.fn5be7Track(d.r16(p));
    this.camera();
  }

  private coast(bx: number): void {                       // 4e38
    const d = this.d;
    const ax = d.rs16(bx + 0x12A6), cx = d.rs16(bx + 0x127A);
    if (cx < -1) {
      d.add16(bx + 0x127A, ax);
      if (d.rs16(bx + 0x127A) >= 0) d.w16(bx + 0x127A, 0);
    } else {
      d.add16(bx + 0x127A, -ax);
      if (d.rs16(bx + 0x127A) < 0) d.w16(bx + 0x127A, 0);
    }
  }

  private jumpTrigger(bx: number): void {                 // 4f17
    const d = this.d;
    if (d.r16(0x26C6) === 2) return;
    if (d.r16(0x2919) !== 1 && this.round !== 7) return;
    if (d.r16(bx + 0x13A4) !== 0) return;
    if (d.r16(bx + 0x1250) === 0) return;
    this.snd(5, 0x0E);
    d.w16(bx + 0x1394, 1); d.w16(bx + 0x1396, 0); d.w16(bx + 0x13A4, 0x3C);
    d.w16(bx + 0x139A, 10); d.w16(bx + 0x139E, 10);
    let si = d.r16(bx + 0x1278) & 0xF8;
    let al = d.r8(0x10A0 + si);
    let dx = (d.r16(bx + 0x1272) + d.r16(bx + 0x1258)) & 0xFFFF;
    let ah = ((dx >> 8) + 8) & 0xF;
    d.w16(bx + 0x13A0, (ah << 8) | al);
    d.w16(bx + 0x1398, (s8(al) >> 3) + d.rs16(bx + 0x125C));
    si = (si - 0x40) & 0xF8;
    al = d.r8(0x10A0 + si);
    dx = (d.r16(bx + 0x1276) + d.r16(bx + 0x1264)) & 0xFFFF;
    ah = ((dx >> 8) + 8) & 0xF;
    d.w16(bx + 0x13A2, (ah << 8) | al);
    d.w16(bx + 0x139C, (s8(al) >> 3) + d.rs16(bx + 0x1268));
  }

  private carControl(bx: number): void {
    const d = this.d;
    const rnd = this.round;
    if (rnd === 9) {
      if (d.r16(bx + 0x12ED) !== 2) return this.carControlMain(bx);
      d.w16(0x26CA, 1);
      if (d.r16(bx + 0x127A) === 0) { d.w16(bx + 0x12AE, 0x0F); return; }
      return this.coast(bx);
    }
    this.catchupFlag(bx);
    if (d.rs16(bx + 0x12ED) > 0) return this.carControlMain(bx);
    if (d.r16(0x2656) !== 2) {
      const sp = d.rs16(bx + 0x127A);
      if (sp > 0) {
        d.add16(bx + 0x127A, -d.rs16(bx + 0x12A4));
        if (d.rs16(bx + 0x127A) < 0) d.w16(bx + 0x127A, 0);
        return this.carControlMain(bx);
      }
      if (sp !== 0) return this.carControlMain(bx);
      d.w16(0x26C6, 0);
      for (const [laps, spd] of [[0x12ED, 0x127A], [0x1451, 0x13DE], [0x15B5, 0x1542], [0x1719, 0x16A6]] as const)
        if (d.r16(laps) === 0 && d.r16(spd) === 0) d.add16(0x26C6, 1);
      if (d.r16(d.r16(0x2660) + 0x12ED) === 0) d.w16(0x26C6, 2);
      return;
    }
    // head to head end-of-race handling (4be7)
    if (d.r16(0x26B4) === 4) {
      if (d.r16(0x26C2) !== 2) {
        if (d.r16(0x26C2) === 0) { d.w16(0x26C2, 3); d.w16(0x26BE, this.vp.bannerOffRight); d.w16(0x26C0, 0x7C); }
        if (d.r16(0x26BE) === this.vp.halfW) {
          d.add16(0x26C2, 1);
          if (d.r16(0x26C2) === 0x64) { d.w16(0x26C2, 3); d.add16(0x26BE, -8); }
        } else if (d.rs16(0x26BE) <= -0x58) d.w16(0x26C2, 0xC8);
        else d.add16(0x26BE, -8);
      }
      return this.carControlMain(bx);
    }
    const h2hInit = (winner: number, order: [number, number]): void => {
      const b = d.r16(winner); d.w16(0x26C4, b); d.w16(0x26B8, b);
      d.w16(0x26C4, order[0]); d.w16(0x2678, order[0]); d.w16(0x267A, order[1]);
      d.w16(0x267C, 0x164); d.w16(0x267E, 0x42C);
      for (const o of [0x2670, 0x2672, 0x2674, 0x2676]) d.w16(o, 0x7D00);
      d.w16(0x26C2, 0xC8); d.w16(0x26BC, 0);
    };
    if (d.rs16(0x26B4) < 4) { if (d.r16(0x26C4) === 1) h2hInit(0x2662, [0x2C8, 0]); }
    else if (d.r16(0x26C4) === 1) h2hInit(0x2660, [0, 0x2C8]);
  }

  private carControlMain(bx: number): void {              // 4d04
    const d = this.d;
    if (d.r16(bx + 0x12AE) !== 0) return;
    if (d.r16(bx + 0x1380) !== 0) {
      if (d.r16(bx + 0x137E) !== 1) return;
      d.w16(bx + 0x1380, 0);
    }
    if (d.r16(bx + 0x124C) === 0) return;
    if (!(d.rs16(bx + 0x12ED) > 0 || d.r16(0x2656) === 2 || d.r16(bx + 0x12EB) !== 1)) return this.coast(bx);
    const dl = d.r8(bx + 0x137B);
    if (d.r16(bx + 0x12EB) !== 1) {
      const ax = d.r16(0x2658 + (d.r16(bx + 0x124A) - 1) * 2);
      if (ax !== 1 && ax !== 2 && (dl & 8)) return this.firePath(bx);
    }
    if ((dl & 0xC0) === 0) {
      const h = d.r16(bx + 0x1278), low = h & 0xF;
      if (low <= 4) d.w16(bx + 0x1278, h & 0xF0);
      else if (low < 0xC) d.w16(bx + 0x1278, (h & 0xF0) | 8);
      else d.w16(bx + 0x1278, (h & 0xF0) + 0x10);
    }
    d.w16(bx + 0x1278, d.r16(bx + 0x1278) & 0xFF);
    if (dl & 0x80) {
      const cx = this.fn4edcSteerRate(bx);
      d.w16(bx + 0x1278, (d.r16(bx + 0x1278) - cx) & 0xFF);
      const sp = d.rs16(bx + 0x127A);
      if (sp >= -0xFF && sp <= 0xFF && this.round <= 6) d.w16(bx + 0x127A, 0xFF);
    }
    if (dl & 0x40) {
      const cx = this.fn4edcSteerRate(bx);
      d.add16(bx + 0x1278, cx);                             // no mask here (original quirk)
      const sp = d.rs16(bx + 0x127A);
      if (sp >= -0xFF && sp <= 0xFF && this.round <= 6) d.w16(bx + 0x127A, 0xFF);
    }
    if (d.r16(0x2656) !== 2) {
      if (d.rs16(0x26C6) >= 2) return this.coast(bx);
      if (d.rs16(bx + 0x12ED) <= 0) return this.coast(bx);
    }
    if ((dl & 0x30) === 0x30) return this.jumpTrigger(bx);
    if ((dl & 0x30) === 0) {
      if (d.rs16(bx + 0x12D6) <= 0) return this.coast(bx);
      return;
    }
    if (d.r16(0x2656) !== 2) {
      if (d.rs16(0x26C6) >= 2) return;
      if (d.rs16(bx + 0x12ED) <= 0) return;
    }
    if (dl & 0x20) {
      const ax = d.rs16(bx + 0x12A2);
      if (d.r8(0x262F) === 1) for (let i = 0; i < 5; i++) d.add16(bx + 0x127A, ax);
      d.add16(bx + 0x127A, ax);
      const cx = d.rs16(bx + 0x129C);
      if (d.rs16(bx + 0x127A) >= cx) d.w16(bx + 0x127A, cx);
    }
    if (dl & 0x10) {
      d.add16(bx + 0x127A, -d.rs16(bx + 0x12A4));
      const cx = d.rs16(bx + 0x12A0);
      if (d.rs16(bx + 0x127A) <= cx) d.w16(bx + 0x127A, cx);
      return;
    }
    if (dl & 8) return this.firePath(bx);
  }

  private firePath(bx: number): void {                    // 4f03
    const d = this.d;
    if (d.r16(0x26C6) === 2 || d.r16(0x2915) === 1) {
      if (d.rs16(bx + 0x12D6) <= 0) return this.coast(bx);
      return;
    }
    return this.jumpTrigger(bx);
  }

  // ---------------------------------------------------------------- fn 525e movement
  fn525eMove(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x124C) !== 0 && d.r16(bx + 0x12AE) === 0 && d.rs16(bx + 0x12D6) <= 0 && d.r16(bx + 0x1380) === 0) {
      this.catchupFlag(bx);
      const spd = d.r16(bx + 0x127A);
      let si = d.r16(bx + 0x1278) & 0xF8;
      d.w16(bx + 0x1270, mulfix(d.rs8(0x10A0 + si), spd));
      si = s16(d.r16(bx + 0x1278) - 0x40);
      if (si <= -1) si += 0x100;
      si &= 0xF8;
      d.w16(bx + 0x1274, mulfix(d.rs8(0x10A0 + si), spd));
      let cx = d.r16(bx + 0x127E), dx = d.r16(bx + 0x127C);
      if (d.r8(0x262F) !== 0) { cx = (cx + (cx >> 1)) & 0xFFFF; dx = (dx + (dx >> 1)) & 0xFFFF; }
      if (d.r16(bx + 0x1286) !== 0) { cx = d.r16(0x28C4); dx = d.r16(0x28C2); d.add16(bx + 0x1286, -1); }
      else if (d.r16(bx + 0x1284) !== 0) { cx = d.r16(0x28C4); dx = d.r16(0x28C2); d.add16(bx + 0x1284, -1); }
      for (const [tgt, cur] of [[0x1270, 0x1272], [0x1274, 0x1276]] as const) {
        let slide = false;
        if (d.r16(bx + 0x1280) !== 0) {
          let ax = s16(d.r16(bx + tgt) - d.r16(bx + cur));
          if (ax <= -1) ax = -ax;
          if (ax > s16(dx)) slide = true;
        }
        if (slide) {
          d.w16(bx + 0x1282, 1);
          let ax = d.rs16(bx + cur);
          if (ax < d.rs16(bx + tgt)) ax += s16(cx); else ax -= s16(cx);
          d.w16(bx + cur, ax);
        } else {
          d.w16(bx + 0x1282, 0);
          d.w16(bx + cur, d.r16(bx + tgt));
        }
      }
      d.w16(bx + 0x1262, this.vp.halfW); d.w16(bx + 0x126E, this.vp.halfH);   // half the view
    }
    // 53c8: skid sound bookkeeping
    if (d.r16(bx + 0x1282) !== 1) return;
    if (this.round === 2 || this.round === 8) return;
    if (this.round === 6) {
      const ax = d.r16(0x28FB);
      if (ax !== 0) { d.w16(0x28FB, ax - 1); return; }
    }
    d.w16(0x28FB, 0x32);
    if (d.r16(0x0F64) !== 1 || bx !== 0 || d.r16(bx + 0x124C) !== 1 || d.r16(bx + 0x1250) === 0) return;
    if (d.r16(0x26B8) !== 1) return;
    this.snd(5, 5);
  }

  // ---------------------------------------------------------------- terrain lookups
  /** fn 589c: block index, MAP bits 6-7, 8x8 cell (bh<<8|bl), progress byte and the COL solid bit at (x, y). */
  fn589cCol(x: number, y: number): { block: number; mapbits: number; cell: number; prog: number; solid: boolean } {
    const d = this.d;
    x &= 0xFFFF; y &= 0xFFFF;
    const bxCol = Math.floor(x / 0x60), bh = (x % 0x60) >> 3;
    const byRow = Math.floor(y / 0x60), bl = (y % 0x60) >> 3;
    const cell = (bxCol + (byRow << 5)) & 0xFFFF;
    const mb = d.r8(0x2963 + cell);
    const block = mb & 0x3F;
    const prog = d.r8(0x2D63 + cell);
    const idx = (bl * 12 + bh) & 0xFF;
    const byte = d.r8(0x3163 + block * 18 + (idx >> 3));
    return { block, mapbits: mb >> 6, cell: (bh << 8) | bl, prog, solid: (byte & (0x80 >> (idx & 7))) !== 0 };
  }

  fn585bDir(bx: number): void {
    const d = this.d;
    let si = ((d.r16(bx + 0x12CC) & 0xFF) * 0x24) & 0xFFFF;
    si += 0x35E3;
    const ax = d.r16(bx + 0x12CE);
    si += (ax >> 8) >> 1;
    si += 3 * ((ax & 0xFF) & ~1);
    const val = d.r8(si);
    d.w16(bx + 0x12DC, d.r16(bx + 0x12DA)); d.w16(bx + 0x12DA, val);
  }

  /** [12e1] <- [12e3] <- cx ; [12e5] = 1 ; true when the progress is 0xFF (void). */
  private progressUpdate(bx: number, cx: number): boolean {
    const d = this.d;
    d.w16(bx + 0x12E1, d.r16(bx + 0x12E3)); d.w16(bx + 0x12E3, cx); d.w16(bx + 0x12E5, 1);
    return d.r16(bx + 0x12E3) === 0xFF;
  }

  private round3Skip(bx: number): boolean {
    const d = this.d;
    return this.round === 3 && d.r16(bx + 0x1388) !== 1 && d.r8(0x25CC + d.r16(bx + 0x12CC)) === 1;
  }

  fn5532Terrain(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x124C) === 0 || d.r16(bx + 0x12AE) !== 0) return;
    this.candidate(bx);
    const { block, mapbits, cell, prog: cx, solid } = this.fn589cCol(d.r16(bx + 0x125E), d.r16(bx + 0x126A));
    d.w16(bx + 0x12CC, block); d.w16(bx + 0x12DE, mapbits); d.w16(bx + 0x12CE, cell); d.w16(bx + 0x12E5, 0);
    this.fn585bDir(bx);
    const rnd = this.round;
    if (rnd === 3) {
      if (solid) {
        if ((d.r16(bx + 0x12DA) & 0xE0) === 0xE0) return this.notSolid(bx, cx);
        return this.solid(bx, cx);
      }
      if (d.r16(bx + 0x12DC) & 0x10) {
        if ((d.r16(bx + 0x12DA) & 0xF0) === 0) this.fn683c(bx);
        return this.notSolid(bx, cx);
      }
      if ((d.r16(bx + 0x12DA) & 0x10) === 0) return this.notSolid(bx, cx);
      if (d.r16(bx + 0x12DA) & 0xA0) { d.w16(bx + 0x12DC, d.r16(bx + 0x12DA)); return this.notSolid(bx, cx); }
      d.w16(bx + 0x12DA, d.r16(bx + 0x12DC));
      if (cx !== 0 && !this.round3Skip(bx)) { if (this.progressUpdate(bx, cx)) return this.respawn(bx); }
      d.w16(bx + 0x138A, 1);
      if (d.rs16(bx + 0x127A) >= 0x100) d.w16(bx + 0x127A, 0x100);
      return this.solidTail(bx);
    }
    if (!solid) return this.notSolid(bx, cx);
    if (rnd === 7) {
      const t = d.r16(bx + 0x12DA) >> 4;
      if (t < 8 && t >= 1) return this.notSolid(bx, cx);
    } else if (rnd === 4 || rnd === 5) {
      if ((d.r16(bx + 0x12DA) >> 4) >= 5) return this.notSolid(bx, cx);
    }
    return this.solid(bx, cx);
  }

  private solid(bx: number, cx: number): void {           // 561d
    if (cx !== 0 && !this.round3Skip(bx)) { if (this.progressUpdate(bx, cx)) return this.respawn(bx); }
    return this.solidTail(bx);
  }

  private solidTail(bx: number): void {                   // 5659
    const d = this.d;
    if (d.r16(bx + 0x1390) !== 0) {
      d.add16(bx + 0x13AC, 1);
      if (d.rs16(bx + 0x13AC) > 0x32) { d.w16(bx + 0x13AC, 0); return this.respawn(bx); }
    } else {
      d.w16(bx + 0x13AC, 0);
      if (d.r16(bx + 0x1250) !== 0) this.snd(5, this.round === 2 ? 4 : 6);
    }
    let ax = d.rs16(bx + 0x125C), dx = d.rs16(bx + 0x1268);
    ax -= 8; if (ax <= -1) ax += 0xC00;
    if (this.fn589cCol(ax, dx).solid) d.w16(bx + 0x12C4, 1);
    ax += 0x10; if (ax >= 0xC00) ax -= 0xC00;
    if (this.fn589cCol(ax, dx).solid) d.w16(bx + 0x12C6, 1);
    dx -= 8; if (dx <= -1) dx += 0xC00;
    ax -= 8; if (ax <= -1) ax += 0xC00;
    if (this.fn589cCol(ax, dx).solid) d.w16(bx + 0x12C8, 1);
    // quirk: the original advances dx and then wraps ax, not dx. Confirmed against tools/mm/sim/race.py.
    dx += 0x10; if (ax >= 0xC00) ax -= 0xC00;
    if (this.fn589cCol(ax, dx).solid) d.w16(bx + 0x12CA, 1);
    if (![0x12C8, 0x12CA, 0x12C4, 0x12C6].some(o => d.r16(bx + o) === 1)) { d.w16(bx + 0x12C8, 1); d.w16(bx + 0x12C4, 1); }
    d.w16(bx + 0x12A8, 1);
  }

  private notSolid(bx: number, cx: number): void {        // 57fb
    const d = this.d;
    d.w16(bx + 0x12A8, 0); d.w16(bx + 0x12E5, 0);
    if (cx !== 0 && !this.round3Skip(bx)) { if (this.progressUpdate(bx, cx)) return this.respawn(bx); }
  }

  /** fn 683c (round 3): tiles with DIR bit 4 launch the car (vsq/12 + 4) and flag [1384]; sound 1 if visible. */
  private fn683c(bx: number): void {
    const d = this.d;
    if (!(d.r16(bx + 0x12DC) & 0x10)) return;
    d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 12) + 4);
    d.w16(bx + 0x1384, 1);
    if (d.r16(bx + 0x1250) !== 0) this.snd(5, 1);
  }

  // ---------------------------------------------------------------- fn 5be7 collision response + commit
  fn5be7Track(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x124C) === 0) return this.tail5e36(bx);
    if (d.r16(bx + 0x12AC) !== 0) { d.w16(bx + 0x12AC, 0); this.candidate(bx); }
    this.fn5532Terrain(bx);
    this.fn5e4eProgress(bx);
    if (d.r16(bx + 0x12FB) !== 0 && d.r16(bx + 0x12A8) !== 0) {
      if (d.r16(bx + 0x12EB) !== 0) {
        d.add16(bx + 0x12AA, 1);
        if (d.rs16(bx + 0x12AA) >= 0x14) this.respawn(bx);
      }
      const probes = [0x12C4, 0x12C6, 0x12C8, 0x12CA].map(o => d.r16(bx + o));
      const halve = d.r16(bx + 0x138A) !== 0;
      const neg = (o: number): void => { d.w16(bx + o, -d.rs16(bx + o)); if (halve) d.w16(bx + o, d.rs16(bx + o) >> 1); };
      if (!probes.some(p => p !== 0)) { neg(0x1272); neg(0x1276); }
      else {
        if (probes[0] === 1 || probes[1] === 1) neg(0x1272);
        if (probes[2] === 1 || probes[3] === 1) neg(0x1276);
      }
      for (const o of [0x12C4, 0x12C6, 0x12C8, 0x12CA]) d.w16(bx + o, 0);
      this.candidate(bx);
    }
    // 5da1 commit
    const st = d.r16(bx + 0x12AE);
    if (st === 0x0E || st === 2 || st === 0) {
      d.w16(bx + 0x125C, d.r16(bx + 0x125E)); d.w16(bx + 0x1268, d.r16(bx + 0x126A));
      d.w16(bx + 0x1258, d.r16(bx + 0x125A)); d.w16(bx + 0x1264, d.r16(bx + 0x1266));
      const al = d.r8(d.r16(0x28B9) + (d.r16(bx + 0x12CC) & 0x3F));
      d.w8(bx + 0x12E0, al);
      if (!(al & 0x80)) {
        let skip = false;
        if (this.round === 3) {
          const v = d.r8(0x25CC + d.r16(bx + 0x12CC));
          skip = d.r16(bx + 0x1388) !== 1 ? v === 1 : v === 0;
        }
        if (!skip) {
          d.w16(bx + 0x12F5, d.r16(bx + 0x12F1)); d.w16(bx + 0x12F1, d.r16(bx + 0x125C));
          d.w16(bx + 0x12F7, d.r16(bx + 0x12F3)); d.w16(bx + 0x12F3, d.r16(bx + 0x1268));
        }
      }
    }
    this.tail5e36(bx);
  }

  private tail5e36(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x138A, 1);
    if (d.r16(0x2919) === 1 || this.round === 7) this.fn79fdShellHit(bx);
  }

  /** fn 79fd (round 7 / weapon mode): a flying shell ([13a4] >= 0x28) of another car landing within 12 px of this
   *  car knocks it out: the shell is removed and the car respawns (state 0x0D) at its current position. */
  private fn79fdShellHit(bx: number): void {
    const d = this.d;
    for (const si of CARS) {
      if (si === bx || d.r16(si + 0x13A4) < 0x28 || d.r16(si + 0x1394) === 0 || d.r16(bx + 0x124E) === 0) continue;
      const cx = s16(d.r16(bx + 0x125C) - d.r16(si + 0x1398));
      if (cx > 0xC || cx < -0xC) continue;
      const dx = s16(d.r16(bx + 0x1268) - d.r16(si + 0x139C));
      if (dx > 0xC || dx < -0xC) continue;
      d.w16(si + 0x1394, 0);
      d.w16(bx + 0x12BA, d.r16(bx + 0x125C)); d.w16(bx + 0x12BC, d.r16(bx + 0x1268));
      d.w16(bx + 0x12AE, 0x0D);
      if (d.r16(bx + 0x1250) !== 0) this.snd(5, 1);
    }
  }

  // ---------------------------------------------------------------- fn 5e4e terrain type, checkpoints, laps
  private checkpointList(): number {
    const d = this.d;
    return d.r16(0x1FEB + (this.round - 1) * 8 + (d.r8(0x28C0) - 1) * 2);
  }

  fn5e4eProgress(bx: number): void {
    const d = this.d;
    const rnd = this.round;
    if (d.r16(0x2656) === 2) {
      const a = d.r16(0x2660), b = d.r16(0x2662);
      if (d.r16(a + 0x12AE) === 1 && d.r16(b + 0x12AE) === 1) { d.w16(0x2913, 1); return; }
      if (d.r16(a + 0x12AE) === 5 && d.r16(b + 0x12AE) === 5) { d.w16(0x2913, 1); return; }
    }
    if (d.r16(bx + 0x12AE) !== 0) return this.tail60c0(bx);
    let ax = d.r16(bx + 0x12DA);
    const shift = (rnd <= 3 || rnd === 6) ? 5 : 4;
    ax = (ax & 0xFF00) | ((ax & 0xFF) >> shift);
    d.w16(bx + 0x12D2, d.r16(bx + 0x12D0)); d.w16(bx + 0x12D0, ax);
    let call: boolean;
    if (d.rs16(bx + 0x12D0) < 5) call = d.r16(bx + 0x12D6) === 0;
    else if (rnd === 4 || rnd === 5) call = true;
    else call = d.r16(bx + 0x12D6) === 0;
    if (call) this.terrainHandler(bx, d.r16(d.r16(0x28BD) + ax * 2));
    if (rnd === 2 && (d.r16(bx + 0x12DA) & 0x18)) this.fn6231Current(bx);
    if (this.round3Skip(bx)) return this.tail60c0(bx);
    if (d.r16(bx + 0x12E5) === 0) return this.tail60c0(bx);
    const delta = s16(d.r16(bx + 0x12E3) - d.r16(bx + 0x12E1)), cx = d.rs16(0x2654);
    if (delta > cx) return this.jumpForward6078(bx);
    if (delta < -cx) return this.jumpBack5fd0(bx);
    return this.checkpoint5f41(bx);
  }

  private checkpoint5f41(bx: number): void {
    const d = this.d;
    const si = this.checkpointList() + d.r16(bx + 0x12E7);
    const ax = d.r16(si);
    if (ax === 0xFFFF) return this.tail60c0(bx);
    const lo = ax & 0xFF, hi = ax >> 8;
    if (d.rs16(bx + 0x12E1) < lo) return this.tail60c0(bx);
    if (d.rs16(bx + 0x12E1) < hi) { d.add16(bx + 0x12E7, 2); return this.tail60c0(bx); }
    return this.shortcut5f85(bx);
  }

  private shortcut5f85(bx: number): void {
    const d = this.d;
    if (d.r16(0x2656) !== 2) {
      d.w16(bx + 0x12F1, d.r16(bx + 0x12F5)); d.w16(bx + 0x12F3, d.r16(bx + 0x12F7));
      this.respawn(bx);
      if (d.r16(bx + 0x1250) !== 0) this.snd(5, 1);
    } else d.add16(bx + 0x12E7, 2);
    return this.tail60c0(bx);
  }

  private jumpBack5fd0(bx: number): void {
    const d = this.d;
    const base = this.checkpointList();
    let si = base + d.r16(bx + 0x12E7);
    let ax = d.r16(si); si += 2;
    if (ax !== 0xFFFF) return this.shortcut5f85(bx);
    si = (si - d.r16(bx + 0x12E7) - 2) & 0xFFFF;
    ax = d.r16(si);
    if (d.rs16(bx + 0x12E3) >= (ax >> 8)) return this.shortcut5f85(bx);
    // lap completed
    d.add16(bx + 0x12ED, -1);
    if (d.r16(0x2656) === 1) {
      if (d.r16(bx + 0x1250) !== 0) this.snd(5, 2);
      if (this.round === 2 && d.r8(0x28C0) === 1 && d.rs16(bx + 0x12ED) <= 2 && bx === 0) {
        const laps = d.rs16(bx + 0x12ED);
        if (d.rs16(0x15B5) > laps && d.rs16(0x1451) > laps && d.rs16(0x1719) > laps) d.w16(0x26C6, 2);
      }
    }
    if (d.rs16(bx + 0x12ED) < 0) d.w16(bx + 0x12ED, 0);
    d.w16(bx + 0x12E7, d.r16(bx + 0x12E9)); d.w16(bx + 0x12E9, 0);
    return this.tail60c0(bx);
  }

  private jumpForward6078(bx: number): void {
    const d = this.d;
    const base = this.checkpointList(); let si = base + d.r16(bx + 0x12E7);
    for (;;) { const ax = d.r16(si); si += 2; if (ax === 0xFFFF) break; }
    si = (si - 2 - base) & 0xFFFF;
    d.w16(bx + 0x12E9, d.r16(bx + 0x12E7)); d.w16(bx + 0x12E7, si);
    d.add16(bx + 0x12ED, 1);
    if (d.rs16(bx + 0x12ED) > 9) d.w16(bx + 0x12ED, 9);
    return this.tail60c0(bx);
  }

  private tail60c0(bx: number): void { if (this.round === 2) this.fn62e3Whirlpool(bx); }

  // ---------------------------------------------------------------- terrain handlers ([28bd] table)
  /** (hi8(vx))^2 + (hi8(vy))^2 with 8-bit signed imul, as at 60de. */
  private vsq(bx: number): number {
    const d = this.d;
    const a = s8(d.r16(bx + 0x1272) >> 8), b = s8(d.r16(bx + 0x1276) >> 8);
    return (a * a + b * b) & 0xFFFF;
  }

  terrainHandler(bx: number, addr: number): void {
    switch (addr) {
      case 0x35BE: return;
      case 0x60CB: return this.h60cb(bx);
      case 0x6169: return this.h6169(bx);
      case 0x618C: return this.h618c(bx);
      case 0x61B0: return this.h61b0(bx);
      case 0x63D6: this.d.w16(bx + 0x128A, 1); return;
      case 0x63DD: return this.h63dd(bx);
      case 0x641A: return this.h641a(bx);
      case 0x6456: case 0x64F5: return this.pullToCentre(bx);
      case 0x6768: return this.h6768(bx);
      case 0x657E: return this.h657e(bx);
      case 0x6622: return this.h6622(bx);
      case 0x6674: return this.h6674(bx);
      case 0x669B: return this.h669b(bx);
      case 0x66ED: return this.h66ed(bx);
      case 0x683B: return;                                                  // round 1 type 7: plain ret
      case 0x6231: return this.fn6231Current(bx);                            // rounds 8/9 water currents
      case 0x6AE5: return this.fn6ae5Pocket(bx);                             // round 3 pool-table pockets
      case 0x6882: return this.h6882(bx);
      case 0x69C5: return this.h69c5(bx);
      case 0x683C: return this.fn683c(bx);
      case 0x6AC2: { const on = (this.d.r16(bx + 0x12DA) & 0x10) !== 0; this.d.w16(bx + 0x1388, on ? 1 : 0); this.d.w16(bx + 0x1386, on ? 0 : 1); return; }
      case 0x67D8: return this.h67d8(bx);
      default: throw new NotImplementedYet(`terrain handler ${addr.toString(16)}`);
    }
  }

  private h60cb(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x1390, 0);
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); }
    if (this.round !== 1) return;
    if (d.r16(bx + 0x12D2) === 4) d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 7) + 4);
    else if (d.r16(bx + 0x12D2) === 3) d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 12) + 4 + 4);
  }

  private h6169(bx: number): void { this.d.w16(bx + 0x1390, 0); this.respawn(bx); this.d.w16(bx + 0x1382, 0x46); }

  private h618c(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x1390) !== 1) { d.w16(bx + 0x1390, 1); return; }
    d.w16(bx + 0x1390, 2);
    if (d.rs16(bx + 0x1272) >= 0) d.add16(bx + 0x1272, 0xC8);
  }

  private h61b0(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); return; }
    const skip = this.round === 5 ? d.r16(bx + 0x12D2) === 3 : d.r16(bx + 0x12D2) === 4;
    if (!skip) {
      d.w16(bx + 0x1272, d.rs16(bx + 0x1272) >> 1); d.w16(bx + 0x1276, d.rs16(bx + 0x1276) >> 1);
      if (d.r16(bx + 0x1250) !== 0) this.snd(5, 6);
    }
    if (d.rs16(bx + 0x127A) >= 0x200) { d.w16(bx + 0x127A, 0x200); this.snd(0x0A, 6); }
  }

  private h63dd(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x12D6) !== 0) return;
    let v = this.vsq(bx);
    if (s16(v) < 0x1C) v = 0x1C;
    d.w16(bx + 0x12D4, Math.floor(v / 8) + 5); d.w16(bx + 0x12D8, 0);
  }

  private h641a(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x12D2) === 6) return;
    let v = this.vsq(bx);
    if (s16(v) < 0xE) return;
    if (s16(v) < 0x1C) v = 0x1C;
    d.w16(bx + 0x12D4, Math.floor(v / 10) + 5);
  }

  private pullToCentre(bx: number): void {                // 6456 / 64f5
    const d = this.d;
    if (d.r16(bx + 0x12F9) === 0) return;
    d.w16(bx + 0x12AE, 1); d.w16(bx + 0x12B0, 0);
    d.w16(bx + 0x125E, (d.r16(bx + 0x125E) & 0xFFF0) + 8);
    d.w16(bx + 0x126A, (d.r16(bx + 0x126A) & 0xFFF0) + 8);
    for (const [cand, cur, out] of [[0x125E, 0x125C, 0x12BE], [0x126A, 0x1268, 0x12C0]] as const) {
      let ax = s16(d.r16(bx + cand) - d.r16(bx + cur));
      if (ax >= 0xBE0) ax -= 0xC00;
      if (ax <= -0xBE0) ax += 0xC00;
      d.w16(bx + out, ax >> 2);
    }
    d.w16(bx + 0x12C2, 4);
    for (const o of [0x1282, 0x1284, 0x1286, 0x1288, 0x1270, 0x1274, 0x1272, 0x1276]) d.w16(bx + o, 0);
  }

  /** Ramp launch on landing, with round-1 variants by surface [12d2] (4: /7, 3: /12); otherwise a sliding car
   *  ([1282]) sets [1288]. */
  private h657e(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); }
    if (this.round === 1) {
      const sf = d.r16(bx + 0x12D2);
      if (sf === 4) { d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 7) + 4); return; }
      if (sf === 3) { d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 12) + 4); return; }
    }
    if (d.r16(bx + 0x1282) !== 0) d.w16(bx + 0x1288, 1);
  }

  /** Bumpy surface: landing impulse, then [128a] = 1 with a sound while moving. */
  private h6622(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); }
    if (d.r16(bx + 0x127A) === 0) return;
    d.w16(bx + 0x128A, 1);
    if (d.r16(bx + 0x1250) !== 0) this.snd(5, 0x12);
  }

  /** Wall-like surface for [12d2] 0 or 2: terrain type reset and both axes flagged as blocked. */
  private h6674(bx: number): void {
    const d = this.d;
    const sf = d.r16(bx + 0x12D2);
    if (sf !== 0 && sf !== 2) return;
    d.w16(bx + 0x12D0, 0); d.w16(bx + 0x12A8, 1); d.w16(bx + 0x12C4, 1); d.w16(bx + 0x12C8, 1);
  }

  /** Sticky surface: [1284] = 0x14 (slide ticks) with a sound. */
  private h669b(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x1284, 0x14);
    if (d.r16(bx + 0x1250) !== 0) this.snd(5, 0x12);
  }

  /** Landing impulse + 6; unless surface 6, a new launch of vsq/9 + 0xb (round 2) or + 2. */
  private h66ed(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 6); }
    if (d.r16(bx + 0x12D2) === 6) return;
    d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 9) + (this.round === 2 ? 0xB : 2));
  }

  /** 692a / 6a27: the car left its level abruptly; probe the four neighbours (x-8, x+8, y-8, y+8) for solid cells and
   *  flag the blocked axes ([12c4]/[12c6] x, [12c8]/[12ca] y); with nothing solid both x-left and y-up are flagged. */
  private levelEdge(bx: number): void {
    const d = this.d;
    const x = d.r16(bx + 0x125C), y = d.r16(bx + 0x1268);
    const wrapL = (v: number): number => (s16(v) <= -1 ? (v + 0xC00) & 0xFFFF : v & 0xFFFF);
    const wrapH = (v: number): number => (v >= 0xC00 ? v - 0xC00 : v);
    const ax0 = wrapL(x - 8);
    if (this.fn589cCol(ax0, y).solid) d.w16(bx + 0x12C4, 1);
    const ax1 = wrapH(ax0 + 0x10);
    if (this.fn589cCol(ax1, y).solid) d.w16(bx + 0x12C6, 1);
    const dy0 = wrapL(y - 8), ax2 = wrapL(ax1 - 8);
    if (this.fn589cCol(ax2, dy0).solid) d.w16(bx + 0x12C8, 1);
    const dy1 = wrapH(dy0 + 0x10);
    if (this.fn589cCol(ax2, dy1).solid) d.w16(bx + 0x12CA, 1);
    if (![0x12C8, 0x12CA, 0x12C4, 0x12C6].some(o => d.r16(bx + o) === 1)) { d.w16(bx + 0x12C8, 1); d.w16(bx + 0x12C4, 1); }
    d.w16(bx + 0x12A8, 1);
  }

  /** Rounds 4/5 level tiles: terrain type - 4 = height ([138e]); type 0xd = -1, 0xe = 4 with a stronger launch.
   *  A drop of more than 2 levels is treated as an edge (levelEdge); a change of 2+ launches the car. */
  private h6882(bx: number): void {
    const d = this.d;
    let ax = d.r16(bx + 0x12D0), strong = false;
    if (ax === 0xD) ax = 0xFFFF; else if (ax === 0xE) { ax = 4; strong = true; } else ax = (ax - 4) & 0xFFFF;
    let dx = s16(ax - d.r16(bx + 0x138E));
    if (dx > 2) return this.levelEdge(bx);
    d.w16(bx + 0x138E, ax);
    if (strong) { d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 7) + 4); return; }
    if (dx === 0) return;
    if (ax !== 0xFFFF) { if (dx <= -1) dx = -dx; if (dx === 1) return; }
    d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 18) + 4);
  }

  /** Rounds 6/7 level tiles: type 8 counts as level 2; same edge/launch rules with vsq/15 + 4. */
  private h69c5(bx: number): void {
    const d = this.d;
    let ax = d.r16(bx + 0x12D0);
    if (ax === 8) ax = 2;
    let dx = s16(ax - d.r16(bx + 0x138E));
    if (dx > 2) return this.levelEdge(bx);
    d.w16(bx + 0x138E, ax);
    if (dx === 0) return;
    if (dx <= -1) dx = -dx;
    if (dx === 1) return;
    d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4);
  }

  private h6768(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); }
    let v = this.vsq(bx);
    if (s16(v) < 0xE) return;
    if (s16(v) < 0x1C) v = 0x1C;
    let ax = Math.floor(v / 7);
    if (this.round === 2) ax += 7;
    d.w16(bx + 0x12D4, ax);
  }

  private h67d8(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x138E) !== 0) { d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, Math.floor(this.vsq(bx) / 15) + 4); }
    throw new NotImplementedYet('handler 67d8 tail');
  }

  fn6231Current(bx: number): void {
    const d = this.d;
    let ax = d.r16(bx + 0x12DA); const dx = d.r16(bx + 0x12DE), cx = d.r8(bx + 0x12E0);
    if (this.round === 2) ax &= 7;
    ax &= 0xF;
    if (dx & 2) ax = d.r8(0x191B + ((cx >> 5) & 3) * 16 + ax);
    ax = d.r16(0x18FB + ax * 2);
    if (dx & 1) ax ^= 0x80;
    let si = 0x10A0 + ax;
    const clamp = (v: number): number => {
      if (s16(v) > d.rs16(bx + 0x129C)) v = d.r16(bx + 0x129C);
      if (s16(v) < d.rs16(bx + 0x12A0)) v = d.r16(bx + 0x12A0);
      return v;
    };
    d.add16(bx + 0x1272, clamp(mulfix(d.rs8(si), 0x100)));
    si = si + 1 - 0x41;
    if (si <= 0x109F) si += 0x100;
    d.add16(bx + 0x1276, clamp(mulfix(d.rs8(si), 0x100)));
    if (d.rs16(bx + 0x127A) >= 0x100) d.w16(bx + 0x127A, 0x100);
  }

  fn62e3Whirlpool(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x12AE) !== 0) return;
    const x = d.rs16(bx + 0x125C), y = d.rs16(bx + 0x1268);
    if (!(x >= 0x614 && x <= 0x68C && y >= 0xB34 && y <= 0xBAC)) return;
    let si = x - 0x650; if (si <= -1) si = -si;
    const cx = (0x3C - si) * 4 + 0x28;
    si = y - 0xB70; if (si <= -1) si = -si;
    const cy = (0x3C - si) * 4 + 5;
    const c = cx > cy ? cy : cx;
    d.add16(bx + 0x1272, x - 0x650 >= 0 ? -c : c);       // jb (unsigned): x < 0x650 keeps the sign
    d.add16(bx + 0x1276, y - 0xB70 >= 0 ? -c : c);
    if (x >= 0x644 && x <= 0x65C && y >= 0xB64 && y <= 0xB7C) {
      d.w16(bx + 0x1382, 0x46); d.w16(bx + 0x12AE, 1);
      d.w16(bx + 0x125E, 0x650); d.w16(bx + 0x126A, 0xB70); d.w16(bx + 0x12C2, 4);
      d.w16(bx + 0x12BE, (0x650 - x) >> 2); d.w16(bx + 0x12C0, (0xB70 - y) >> 2);
    }
  }

  // ---------------------------------------------------------------- car-car collisions (fn 5921 / 5960)
  fn5921Collisions(): void {
    const d = this.d;
    // bx is not reloaded between the six calls: it enters as the last car of the fn 525e loop and leaves each call
    // as A (A inactive or not in state 0/2) or B (every other exit); fn 5960 recomputes that car's candidate first.
    let bx: number = CARS[3];
    // 5921: only one of [27b1]/[27b3] is rewritten per call, so the pairs are (0,1) (0,2) (0,3) (1,3) (1,2) (3,2)
    const pairs: [number, number][] = [[0x2660, 0x2662], [0x2660, 0x2664], [0x2660, 0x2666], [0x2662, 0x2666], [0x2662, 0x2664], [0x2666, 0x2664]];
    for (const [a, b] of pairs) {
      d.w16(0x27B1, d.r16(a)); d.w16(0x27B3, d.r16(b));
      bx = this.fn5960Pair(bx);
    }
  }

  /** Returns the value bx holds on exit (see fn5921Collisions). */
  fn5960Pair(bxEntry: number): number {
    const d = this.d;
    this.candidate(bxEntry);                                // quirk: recomputes the candidate of whatever bx holds
    const A = d.r16(0x27B1), B = d.r16(0x27B3);
    if (d.r16(A + 0x124C) === 0) return A;
    let dx = d.rs16(A + 0x125E), di = d.rs16(A + 0x126A);
    if (d.r16(A + 0x12AE) !== 2) {
      if (d.r16(A + 0x12AE) !== 0) return A;
      if (d.r16(B + 0x124C) === 0) return B;
      if (d.r16(B + 0x12AE) !== 2 && d.r16(B + 0x12AE) !== 0) return B;
    }
    dx -= d.rs16(B + 0x125E); di -= d.rs16(B + 0x126A);
    if (dx >= 0xBF0) dx -= 0xC00;
    if (dx <= -0xBF0) dx += 0xC00;
    if (di >= 0xBF0) di -= 0xC00;
    if (di <= -0xBF0) di += 0xC00;
    if (dx > 0x10 || dx < -0x10 || di > 0x10 || di < -0x10) return B;
    dx = ((dx + 0x10) & 0xFFFF) >> 1; di = ((di + 0x10) & 0xFFFF) >> 1;
    di = di * 17 + dx + 0x17DA;
    if (di >= 0x18FB) return B;
    const n = d.r8(di);
    if (n === 0) return B;
    if (d.r16(A + 0x12AE) === 2 || d.r16(B + 0x12AE) === 2) {
      d.w16(A + 0x12AC, 1); d.w16(A + 0x1272, 0x40); d.w16(A + 0x1276, 0x40);
      d.w16(B + 0x12AC, 1); d.w16(B + 0x1272, 0xFFC0); d.w16(B + 0x1276, 0xFFC0);
      return B;
    }
    const dvx = s16(d.r16(A + 0x1272) - d.r16(B + 0x1272)), dvy = s16(d.r16(A + 0x1276) - d.r16(B + 0x1276));
    let si = 0x10A0 + n;
    const sin = d.rs8(si); si += 1;
    si -= 0x41;
    if (si <= 0x109F) si += 0x100;
    const cos = d.rs8(si);
    let imp = s16(s16(mulfix(dvx, sin)) - s16(mulfix(dvy, cos)));
    if (imp <= 0x1F4) imp = 0x1F4;
    if (this.round === 6 && imp > 0x1F4) {
      if (d.r16(A + 0x1250) !== 0) {
        this.respawn(A); this.snd(5, 1);
        if (d.r16(B + 0x1250) !== 0) { this.respawn(B); this.snd(5, 1); }
      }
    }
    const ix = mulfix(imp, sin), iy = mulfix(imp, cos);
    d.w16(A + 0x12AC, 1); d.add16(A + 0x1272, -ix); d.add16(A + 0x1276, -iy);
    d.w16(B + 0x12AC, 1); d.add16(B + 0x1272, ix); d.add16(B + 0x1276, iy);
    if (d.r16(B + 0x1250) !== 0) this.snd(5, 3);
    return B;
  }


  // ---------------------------------------------------------------- camera (4fd1..51b0)
  private camera(): void {
    const d = this.d;
    const bx = d.r16(0x27B7 + d.r16(0x27B5) * 2);
    if (bx !== 1) {
      let ax = s16(d.r16(bx + 0x125C) - d.r16(bx + 0x1262));
      if (ax <= -1) ax += 0xC00;
      d.w16(0x2646, ax);
      ax = s16(d.r16(bx + 0x1268) - d.r16(bx + 0x126E));
      if (ax <= -1) ax += 0xC00;
      d.w16(0x2648, ax);
    } else {
      const a = d.r16(0x2660), b = d.r16(0x2662);
      const cx = d.rs16(b + 0x125C); let ax = s16(d.r16(a + 0x125C) - cx);
      if (ax >= this.vp.h2hWrapX) ax -= 0xC00;
      if (ax <= -this.vp.h2hWrapX) ax += 0xC00;
      if (ax > this.vp.h2hX || ax < -this.vp.h2hX) { if (d.r16(0x2911) !== 2) d.w16(0x2911, 1); }
      else {
        ax = (ax >> 1) + cx - this.vp.halfW;
        const cy = d.rs16(b + 0x1268); let dx = s16(d.r16(a + 0x1268) - cy);
        if (dx >= this.vp.h2hWrapY) dx -= 0xC00;
        if (dx <= -this.vp.h2hWrapY) dx += 0xC00;
        if (dx > this.vp.h2hY || dx < -this.vp.h2hY) { if (d.r16(0x2911) !== 2) d.w16(0x2911, 1); }
        else {
          dx = (dx >> 1) + cy - this.vp.halfH;
          if (ax <= -1) ax += 0xC00;
          if (ax >= 0xC00) ax -= 0xC00;
          if (dx <= -1) dx += 0xC00;
          if (dx >= 0xC00) dx -= 0xC00;
          d.w16(0x2646, ax); d.w16(0x2648, dx);
        }
      }
    }
    for (const o of [0x137E, 0x14E2, 0x1646, 0x17AA]) d.w16(o, 0);
    // The swoop compares the target and the camera as plain 16-bit numbers, so when the two sit on opposite
    // sides of the world seam the gap reads as about 0xb00 and the camera jumps the whole way instead of
    // gliding in. That is what the original does and the traces pin it, but which tracks it happens on
    // depends on where the seam falls relative to the camera, and a wider view moves the camera off it. So
    // the decision is taken on the camera the original would have, and only the movement applied here.
    for (const [tgt, cam, step, off] of [[0x2646, 0x264A, 0x264E, this.vp.camOffsetX],
                                         [0x2648, 0x264C, 0x2650, this.vp.camOffsetY]] as const) {
      const cx = d.rs16(step);
      let ax = s16(((d.r16(tgt) + off) % 0xC00) - ((d.r16(cam) + off) % 0xC00)); let dx = ax;
      if (ax <= -1) ax = -ax;
      if (ax > 0x3E8 || ax <= cx) d.w16(step, 0x32);
      else { ax = cx; if (dx <= -1) ax = -ax; dx = ax; }
      d.add16(cam, dx);
      if (off !== 0) d.w16(cam, (d.rs16(cam) % 0xC00 + 0xC00) % 0xC00);   // a world coordinate again
    }
    if (d.r16(0x2650) === 0x32 && d.r16(0x264E) === 0x32) for (const o of [0x137E, 0x14E2, 0x1646, 0x17AA]) d.w16(o, 1);
  }

  // ---------------------------------------------------------------- render-pass side effects (fn 90c5)
  /** Car sprite draw (fn 7d73): sets [1250] = drawn, using the same clip test as the blitter. */
  fn7d73Visibility(bx: number): void {
    const d = this.d;
    if (d.r16(0x2621) === bx) { d.w16(bx + 0x1250, 0); return; }
    d.w16(bx + 0x1250, 1);
    const dz = this.round === 8 ? 0 : d.rs16(bx + 0x12D6);
    let di = d.rs16(bx + 0x125C) - dz, ax = d.rs16(bx + 0x1268) - dz;
    let w: number;
    if (this.round === 9) {
      if (bx !== 0) return;
      di -= d.rs16(0x264A); if (di <= -4) di += 0xC00;
      ax -= d.rs16(0x264C); if (ax <= -4) ax += 0xC00;
      ax -= 0x14; di -= 0x14; w = 0x28;
    } else {
      di -= d.rs16(0x264A); if (di <= -0xC) di += 0xC00;
      ax -= d.rs16(0x264C); if (ax <= -0xC) ax += 0xC00;
      ax -= 0xC; di -= 0xC; w = 0x18;
    }
    const x = s16(di), y = s16(ax);
    let clipped = false;
    if (x < 0) { if (x + w <= 0) clipped = true; } else if (x >= this.vp.logicWidth) clipped = true;
    if (!clipped) { if (y < 0) { if (y + w <= 0) clipped = true; } else if (y >= this.vp.logicClipH) clipped = true; }
    if (clipped) d.w16(bx + 0x1250, 0);
    else if (this.round === 8) {                              // 7e3a..7e4f: helicopter rotor (fn 843d) advances [1392]
      const st = d.r16(bx + 0x12AE);
      if (st !== 0x0D && st !== 2) d.add16(bx + 0x1392, 1);
    }
  }

  /** HUD/ranking (fn 8dfc): score per car in leader-list order, bubble sort of the list, rank -> [12ef]. */
  fn8dfcRanking(): void {
    const d = this.d;
    if (this.round === 9) return;                            // 8ff5: time trial only draws the elapsed time (no state)
    if (d.r16(0x2656) === 2) return this.fn8f03Ranking();
    const cl = d.r16(0x2652) & 0xFF;
    for (let si = 0; si < 8; si += 2) {
      const bx = d.r16(0x2678 + si);
      if (d.rs16(bx + 0x12ED) > 0 && d.rs16(0x26C6) < 2) {
        const ax = ((9 - d.r16(bx + 0x12ED)) & 0xFF) * cl;
        d.w16(0x2670 + si, ax + d.r16(bx + 0x12E3));
        // quirk: the else branch resets all four score words, not just the one at 0x2670 + si.
      } else for (const o of [0x2670, 0x2672, 0x2674, 0x2676]) d.w16(o, 0x7D00);
    }
    for (let pass = 0; pass < 3; pass++) for (const bx of [0, 2, 4]) {
      const ax = d.rs16(bx + 0x2670), dx = d.rs16(bx + 0x2672);
      if (ax < dx) {
        d.w16(bx + 0x2670, dx); d.w16(bx + 0x2672, ax);
        const a2 = d.r16(bx + 0x2678); d.w16(bx + 0x2678, d.r16(bx + 0x267A)); d.w16(bx + 0x267A, a2);
      }
    }
    [0x2678, 0x267A, 0x267C, 0x267E].forEach((o, i) => d.w16(d.r16(o) + 0x12EF, i + 1));
  }

  /** State changes made by fn 90c5 (renderer) that the physics reads back. */
  renderSideEffects(): void {
    const d = this.d;
    this.banner = undefined;
    if (d.r16(0x2913) !== 0) this.fn78f8();                // 91f2: both cars are back, or one has been left behind
    else if (d.r16(0x2911) === 1) this.fn7759();
    if (this.round === 2) d.add16(0x26D1, 1);              // fn 89e0 water colour cycling counter
    else if (this.round === 8 && d.r8(0x28C0) !== 1) {     // fn 8a2b: tile animation counter, phase 3 resets it
      d.add16(0x26D3, 1);
      if (((d.r16(0x26D3) >> 2) & 3) === 3) d.w16(0x26D3, 0);
    }
    for (const bx of CARS) { this.fn8386Skids(bx); this.fn8083Tracks(bx); }
    for (const bx of CARS) if (d.r16(bx + 0x13A4) !== 0) this.fn8712Particles(bx);
    for (const bx of CARS) {
      if (d.r16(bx + 0x12AE) === 0x0E || d.r16(bx + 0x124C) !== 0) {
        const st = d.r16(bx + 0x12AE);
        switch (st) {
          case 0: case 0x0B: case 0x0C: this.fn7d73Visibility(bx); break;
          case 0x0A: this.fn849bCountdown(bx); break;
          case 0x0D: case 2: this.fn82beRespawn(bx); break;
          case 7: this.fn6febReappear(bx); break;
          case 1: this.fn880aPulled(bx); break;
          case 4: this.fn7f62Pocketed(bx); break;
          case 5: this.fn7efaBounce(bx); break;
          case 0x0E: this.fn6ae5Pocket(bx); break;
          case 0x0F: this.fn8683Banner(bx, true); break;
          case 0x10: this.fn8683Banner(bx, false); break;
          default: throw new NotImplementedYet(`state handler for state ${st.toString(16)}`);
        }
      }
    }
    this.fn8dfcRanking();
    this.h2hBanners();                                     // 9241..927e
    this.engineSound();                                    // fn 90c5 ends with fn 7b46
  }

  /** fn 8f03: the same score in a two-car race, with one bubble pass, and a wrap-around correction: when the
   *  two progress values are more than half a lap apart the smaller one is really the one in front. */
  private fn8f03Ranking(): void {
    const d = this.d;
    const cl = d.r16(0x2652) & 0xFF;
    for (let si = 0; si <= 2; si += 2) {
      const bx = d.r16(0x2678 + si);
      const ax = (((9 - d.r16(bx + 0x12ED)) & 0xFF) * cl) & 0xFFFF;
      d.w16(0x2670 + si, ax + d.r16(bx + 0x12E3));
    }
    const ax = d.rs16(0x2670), dx = d.rs16(0x2672);
    if (ax < dx) {
      d.w16(0x2670, dx); d.w16(0x2672, ax);
      const a = d.r16(0x2678); d.w16(0x2678, d.r16(0x267A)); d.w16(0x267A, a);
    }
    if (d.rs16(0x12ED) <= 0 && d.rs16(0x1451) <= 0) {          // 8f5a: neither car has laps left to run
      const gap = Math.abs(d.rs16(0x12E3) - d.rs16(0x1447));
      if (gap >= d.rs16(0x2654)) {
        const car1Ahead = d.rs16(0x1447) > d.rs16(0x12E3);
        d.w16(0x2678, car1Ahead ? 0 : 0x164);
        d.w16(0x267A, car1Ahead ? 0x164 : 0);
      }
    }
    d.w16(d.r16(0x2678) + 0x12EF, 1);
    d.w16(d.r16(0x267A) + 0x12EF, 2);
  }

  // ---------------------------------------------------------------- head to head (fn 7759 / 78f8 / 75d2 / 851f)
  /** fn 7af8: with the AdLib driver the engines go quiet by having their speed zeroed (the speaker driver
   *  stops its two engine voices instead, which the port does not have). */
  private fn7af8(): void {
    const d = this.d;
    if (d.r16(0x0F64) !== 1) return;
    for (const bx of CARS) d.w16(bx + 0x127A, 0);
  }

  /**
   * fn 7759: a car has been left behind, so this round of the head to head is over. The car in front is
   * parked in state 0x0b and the other one is moved onto its last checkpoint in state 0x0c. Called from the
   * render pass (91fe) when [2911] == 1.
   */
  fn7759(): void {
    const d = this.d;
    const a = d.r16(0x2660), b = d.r16(0x2662);
    let bx: number, si: number;
    if (d.r16(0x2682) !== 0xFFFF) {                          // a collision already named the car (fn 6c01)
      bx = d.r16(0x2682); d.w16(0x2682, 0xFFFF);
      si = bx === a ? b : a;
    } else {
      if (d.r16(a + 0x12AE) === 0x0C) return;
      d.w16(a + 0x12BA, d.r16(a + 0x125C)); d.w16(a + 0x12BC, d.r16(a + 0x1268));
      const cx = d.r16(a + 0x12EF);
      if (d.r16(b + 0x12AE) === 0x0C) return;
      d.w16(b + 0x12BA, d.r16(b + 0x125C)); d.w16(b + 0x12BC, d.r16(b + 0x1268));
      d.w16(0x2911, 2);
      if (cx > d.r16(b + 0x12EF)) { si = a; bx = b; } else { si = b; bx = a; }
      if (d.r16(bx + 0x12AE) !== 0) { const t = bx; bx = si; si = t; }
    }
    const di = d.r16(bx + 0x138C);                           // 77d9: drop the car's entry from the sprite lists
    for (const o of [0x268A, 0x2684, 0x2686, 0x2688]) d.w16(di + o, 0);
    d.w16(0x26B8, bx);
    d.w16(bx + 0x124C, 1);
    d.w16(0x2682, 0xFFFF);
    if (!(this.round === 2 && d.r16(bx + 0x12D0) === 5)) {    // 7805: a car already in the plughole keeps falling
      d.w16(bx + 0x12D4, 0x14); d.w16(bx + 0x12D6, 0); d.w16(bx + 0x12D8, 1);
    }
    d.w16(0x27B5, d.r16(bx + 0x124A));
    d.w16(0x264E, 4); d.w16(0x2650, 4);
    const cx = d.r16(bx + 0x12F1), dx = d.r16(bx + 0x12F3);
    for (const o of [0x127A, 0x1272, 0x1276, 0x1274, 0x1270]) d.w16(bx + o, 0);
    d.w16(bx + 0x12AE, 0x0B);
    d.w16(si + 0x12F1, cx); d.w16(si + 0x12F3, dx);
    for (const o of [0x127A, 0x1272, 0x1276, 0x1274, 0x1270]) d.w16(si + o, 0);
    d.w16(si + 0x12AE, 0x0C);
    this.fn7af8();
    for (let al = 0; al <= 8; al++) this.snd(8, al);          // 7893: the whole effect bank on the second queue
    if (d.r16(bx + 0x1250) !== 0) this.snd(5, 0x0A);
  }

  /** fn 78f8: both cars come back. Whoever is behind is moved onto the leader's checkpoint and the two of
   *  them reappear together (state 7). Called from the render pass (91f2) when [2913] != 0. */
  fn78f8(): void {
    const d = this.d;
    const a = d.r16(0x2660), b = d.r16(0x2662);
    const sa = d.r16(a + 0x12AE), sb = d.r16(b + 0x12AE);
    for (const st of [1, 5]) {                               // 78fc: one of them is still away
      if (sa === st) { if (sb !== st) d.w16(b + 0x124C, 0); return; }
      if (sb === st) { if (sa !== st) d.w16(a + 0x124C, 0); return; }
    }
    const [from, to] = d.r16(a + 0x12EF) > d.r16(b + 0x12EF) ? [b, a] : [a, b];
    d.w16(to + 0x12F1, d.r16(from + 0x12F1));
    d.w16(to + 0x12F3, d.r16(from + 0x12F3));
    d.w16(to + 0x1388, d.r16(from + 0x1388));
    for (const c of [a, b]) { d.w16(c + 0x124C, 1); d.w16(c + 0x12AE, 7); }
    d.w16(0x2913, 0); d.w16(0x2911, 0);
  }

  /**
   * fn 75d2, the tail of fn 7429 in a head to head: the 0x40-tick score animation. The bar [26b4] and the
   * value it is moving to [26b6] swap every eight ticks so the winning segment flashes; when the count runs
   * out both cars respawn, and at 8 or 0 the match is over.
   */
  private fn75d2(bx: number): void {
    const d = this.d;
    if (d.r16(0x26B8) === 1) return;                         // nobody has been caught out
    if (d.r16(0x26B8) !== bx) return;                        // only the winner's car drives the animation
    const a = d.r16(0x2660), b = d.r16(0x2662);
    if (d.r16(0x26BA) === 0) {
      d.w16(0x26BA, 0x40);
      d.w16(a + 0x12AE, 0x0C); d.w16(b + 0x12AE, 0x0C);
      if (this.round === 2 || this.round === 8) { d.w16(a + 0x1382, 0); d.w16(b + 0x1382, 0); }
      d.w16(0x26B6, d.r16(0x26B4) + (d.r16(0x26B8) === a ? 1 : -1));
      return;
    }
    if ((d.r16(0x26BA) & 7) === 0) {
      const ax = d.r16(0x26B4);
      d.w16(0x26B4, d.r16(0x26B6)); d.w16(0x26B6, ax);
    }
    d.add16(0x26BA, -1);
    if (d.r16(0x26BA) !== 0) return;
    if (d.rs16(a + 0x12ED) > 0) d.w16(0x26C2, 1);            // 7669: the banner slides off again
    d.w16(0x26BE, this.vp.halfW); d.w16(0x26C0, 0x7C);
    d.w16(0x27B5, 0);
    this.fn78f8();
    d.w16(0x2911, 2);
    for (const c of [a, b]) {
      d.w16(c + 0x124C, 1); d.w16(c + 0x12AE, 0x0D);
      d.w16(c + 0x12B8, 0); d.w16(c + 0x12B0, 0);
    }
    const finish = (car: number): void => {
      d.w16(0x26C4, car); d.w16(0x26C6, 2);
      if (d.r16(car + 0x1250) !== 0) this.snd(5, 0x10);
    };
    if (d.r16(0x26C4) !== 1) {                               // 7742: the match already has a winner
      d.w16(0x26C6, 2);
      if (d.r16(a + 0x1250) !== 0) this.snd(5, 0x10);
      return;
    }
    if (d.r16(0x26B8) === a) {
      if (d.rs16(a + 0x12ED) > 0) {
        d.w16(0x26B8, 1); d.add16(0x26B4, 1);
        if (d.r16(0x26B4) !== 8) return;
      }
      finish(a);
    } else {
      if (d.rs16(b + 0x12ED) > 0) {
        d.w16(0x26B8, 1); d.add16(0x26B4, -1);
        if (d.r16(0x26B4) !== 0) return;
      }
      finish(b);
    }
  }

  /** 9241..927e: the banners of a head to head. fn 851f (the car in state 0x0b) spins it on the spot, fn 855a
   *  (state 0x0c) slides the WINNER banner down once the bar is full, and fn 8634 slides BONUS away again.
   *  The drawing itself is RaceRenderer.banners, which reads `banner` back. */
  private h2hBanners(): void {
    const d = this.d;
    const a = d.r16(0x2660), b = d.r16(0x2662);
    const sa = d.r16(a + 0x12AE);
    if (sa === 0x0C) this.fn855a(a); else if (sa === 0x0B) this.fn851f();
    const sb = d.r16(b + 0x12AE);
    if (sb === 0x0C) { this.fn855a(b); return; }
    if (sb === 0x0B) this.fn851f();
    if (d.r16(0x26C2) !== 0) this.fn8634();
  }

  /** fn 851f: the caught-out car keeps spinning while BONUS is up. */
  private fn851f(): void {
    const d = this.d;
    this.fn7af8();
    const bx = d.r16(0x26B8);
    if (this.round === 9) return;
    d.w16(bx + 0x1278, (d.r16(bx + 0x1278) + 8) & 0xFF);
    if (d.rs16(0x26B4) >= 7 || d.rs16(0x26B4) <= 1) return;
    if (d.rs16(bx + 0x12ED) <= 0) return;
    this.banner = { src: 0x7423, x: this.vp.halfW, y: 0x7C };
  }

  /** fn 855a: BONUS at a fixed spot, or, on the last point of the match, WINNER sliding down from off-screen. */
  private fn855a(bx: number): void {
    const d = this.d;
    this.fn7af8();
    if (this.round === 9) return;
    if (bx !== d.r16(0x26B8)) return;
    if (this.round === 8) d.w16(bx + 0x1278, (d.r16(bx + 0x1278) + 8) & 0xFF);
    const total = (d.r16(0x26B4) + d.r16(0x26B6)) & 0xFFFF;
    if (total !== 0x0F && total !== 1 && d.r16(0x26C2) !== 0xC8 && d.r16(0x26C2) !== 2) {
      this.banner = { src: 0x7423, x: this.vp.halfW, y: 0x7C };   // 85ac
      return;
    }
    if (d.r16(0x26C2) === 0 || d.r16(0x26C2) === 0xC8) {     // 85c1
      d.w16(0x26BE, this.vp.halfW); d.w16(0x26C0, 0xFFE8); d.w16(0x26C2, 2);
    }
    d.w16(0x26BE, this.vp.halfW);
    d.add16(0x26C0, 8);
    if (d.rs16(0x26C0) >= 0x7C) d.w16(0x26C0, 0x7C);
    this.snd(0x0A, 0x10);
    this.fn7af8();
    const winner = d.r16(0x26B8);
    const loser = winner === d.r16(0x2660) ? d.r16(0x2662) : d.r16(0x2660);
    d.w16(0x2621, loser);                                    // 861c: whose car the results screen shows
    d.w16(0x2630, winner === d.r16(0x2660) ? 1 : 2);
    this.banner = { src: 0x7C63, x: d.rs16(0x26BE), y: d.rs16(0x26C0) };
  }

  /** fn 8634: BONUS sliding off to the left, or PLAY OFF while the deciding round is set up. */
  private fn8634(): void {
    const d = this.d;
    if (d.rs16(0x26C2) < 3) {
      d.add16(0x26BE, -8);
      this.banner = { src: 0x7423, x: d.rs16(0x26BE), y: d.rs16(0x26C0) };
      return;
    }
    if (d.rs16(0x26C2) < 0x64) this.banner = { src: 0x84A3, x: d.rs16(0x26BE), y: d.rs16(0x26C0) };
  }

  // ---------------------------------------------------------------- pause and the debug keys (fn 35f0)
  /**
   * fn 35f0: the key at index 14 of the SETTINGS.DAT table (Space) pauses the race. Before the banner goes
   * up the game looks for a CHEATS.BIN record for this round and track within 0x18 of the player's car and
   * applies it, which is what the game's "cheats" really are. See re/notes/53-cheats.md.
   */
  private fn35f0(): void {
    const d = this.d;
    this.snd(6, 0);                                          // 35f0: ah=8 with a stale al, then ah=6
    this.cheatSpot();
    d.w16(0x2633, 1);
    this.fn7af8();
    d.w16(0x261F, 0);
    d.w8(0x107E, 0); d.w8(0x107F, 0);
    this.pauseStage = 1;
  }

  /** True while the race is held. The page shows the Paused! banner and keeps the tick counters running. */
  get paused(): boolean { return this.pauseStage !== 0; }

  /** fn 35f0 from 3789: one tick of the pause. False once the race may carry on. */
  pauseStep(): boolean {
    const d = this.d;
    if (this.pauseStage === 1) {                             // 3789: a key or 0x8c ticks take the banner down
      if (d.r8(0x107E) === 0 && d.r16(0x261F) !== 0x8C) return true;
      d.w16(0x2633, 2); d.w16(0x2638, 1);
      this.pauseRender = true;                               // 37a4: fn 90c5 puts the race back on screen
      this.fn7af8();
      this.snd(6, 0);
      this.pauseStage = 2;
      return true;
    }
    if (this.pauseStage === 2) {                             // 37b8: and then wait for a key
      if (d.r8(0x107E) === 0) return true;
      this.pauseStage = 3;
      return true;
    }
    // 37bf: only with the cheat code typed on GAME OPTIONS, and never in the time trial
    if (d.r8(0x0F69) === 1 && this.round !== 9) {
      if (d.r8(0x107E) === 0x58) this.screenDump = true;      // F12 (fn 35bf writes the back buffer to a file)
      else if (d.r16(0x107C) === 0x600) { this.applySpot(9, 0); this.endPause(); return false; }   // F1 + F2
      else if (d.r16(0x107C) === 0x300) { this.applySpot(1, 0); this.endPause(); return false; }   // F2 + F3
      else if (d.rs16(0x261F) < 0x8C) return true;            // 37ed: keep watching for a couple of seconds
    }
    this.endPause();
    return false;
  }

  /** F12 on the pause screen: fn 35bf dumps the back buffer to a numbered file. The page decides how. */
  screenDump = false;

  private endPause(): void { this.d.w16(0x2633, 0); this.pauseStage = 0; }

  /** 35fe: the CHEATS.BIN record the player's car is standing on, if any. */
  private cheatSpot(): void {
    const d = this.d;
    const bx = d.r16(0x2660);
    for (let si = 0x1BDB; si <= 0x1FCB; si += 12) {
      if ((d.r16(si) & 0xFF) !== d.r8(0x28BF)) continue;
      if ((d.r16(si + 2) & 0xFF) !== d.r8(0x28C0)) continue;
      if (Math.abs(s16(d.r16(si + 4) - d.r16(bx + 0x125C))) >= 0x18) continue;
      if (Math.abs(s16(d.r16(si + 6) - d.r16(bx + 0x1268))) >= 0x18) continue;
      const kind = d.r16(si + 8);
      if (kind > 9) return;                                  // 369d: no flash either
      this.applySpot(kind, d.r16(si + 0x0A));
      return;
    }
  }

  /** 36a0..3732: what each kind does to the player's car, then the white flash of 3734. */
  private applySpot(kind: number, value: number): void {
    const d = this.d;
    const bx = d.r16(0x2660);
    switch (kind) {
      case 0: d.w8(0x0406, (d.r8(0x0406) - 1) & 0xFF); break;          // a life
      case 1:
        d.w16(0x26C6, 4); d.w16(0x2635, 1);
        d.w16(0x26C4, 0); d.w16(0x2678, 0); d.w16(0x267A, 0x2C8);
        d.w16(0x267C, 0x164); d.w16(0x267E, 0x42C);
        for (const o of [0x2670, 0x2672, 0x2674, 0x2676]) d.w16(o, 0x7D00);
        break;
      case 2: d.w16(bx + 0x127C, value); break;
      case 3: d.w16(bx + 0x127E, value); break;
      case 4: d.w16(bx + 0x12A2, value); break;
      case 5: d.w16(0x2915, 1); break;
      case 6: d.w16(0x2917, 1); break;
      case 7: d.w16(bx + 0x12F9, 0); break;
      case 8: d.w16(bx + 0x129C, 0x800); break;
      case 9: d.w16(0x2915, 1); d.w16(0x2919, 1); d.w16(0x291B, 4); break;
      default: return;
    }
    this.pauseFlash = true;
  }

  /** States 0x0F / 0x10 (round 9 time trial: time up / finished): fn 8683 / 86a8 -> 86d2. Draws the car, then a
   *  banner sliding down from y = 0 to 0x7c at x = 0x80; [26c6] = 2 while it slides. 0x0F also sets [291d]. */
  fn8683Banner(bx: number, timeUp: boolean): void {
    const d = this.d;
    this.snd(5, timeUp ? 0x10 : 0x0F);
    this.fn7d73Visibility(bx);
    if (d.r16(0x26C2) === 0) { d.w16(0x26BE, this.vp.halfW); d.w16(0x26C0, 0); d.w16(0x26C2, 0x3E8); }
    d.w16(0x26BE, this.vp.halfW);
    if (d.r16(0x26C0) <= 0x7C) { d.w16(0x26C6, 2); d.add16(0x26C0, 8); }
    d.w16(0x291D, timeUp ? 1 : 0);
  }

  // ---------------------------------------------------------------- round 3 pockets (fn 6ae5, states 4 / 5 / 0x0E)
  /** Wrap a world-coordinate difference to -0xBE0..0xBE0 and quarter it (6bba..6bd2). */
  private static quarterDiff(v: number): number {
    let ax = s16(v);
    if (ax >= 0xBE0) ax -= 0xC00;
    if (ax <= -0xBE0) ax += 0xC00;
    return ax >> 2;
  }

  /** 6b18..6b69: find the pocket record (7 words at ds:22e1: block x, block y, min progress, exit x, exit y, exit
   *  heading, pocket index) within one block of the car. Returns the offset of the min-progress word, or -1
   *  (always -1 on track 1). */
  private pocketRecord(bx: number): number {
    const d = this.d;
    const dx = Math.floor(d.r16(bx + 0x125C) / 0x60), cy = Math.floor(d.r16(bx + 0x1268) / 0x60);
    let si = 0x22E1;
    for (;;) {
      let ax = d.rs16(si); si += 2;
      let miss = Math.abs(ax - dx) > 1;
      if (miss) { ax = d.rs16(si); si += 2; }
      else { ax = d.rs16(si); si += 2; miss = Math.abs(ax - cy) > 1; }
      if (!miss) return si;
      if (d.r8(0x28C0) === 1) return -1;
      si += 0xA;
      if (ax === -1) return -1;
    }
  }

  /** 6f58: not a usable pocket: bounce back to the cell centre (state 5) if the car is on the track ([12f9]). */
  private pocketBounce(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x12F9) === 0) return;
    d.w16(bx + 0x12AE, 5); d.w16(bx + 0x12B0, 0);
    this.pocketCentre(bx);
    for (const o of [0x1282, 0x1284, 0x1286, 0x1288]) d.w16(bx + o, 0);
    d.w16(bx + 0x1382, 0);
  }

  /** Candidate = centre of the 16 px cell; knockback deltas = a quarter of the way there over 4 ticks. */
  private pocketCentre(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x125E, (d.r16(bx + 0x125E) & 0xFFF0) + 8); d.w16(bx + 0x126A, (d.r16(bx + 0x126A) & 0xFFF0) + 8);
    d.w16(bx + 0x12BE, Race.quarterDiff(d.r16(bx + 0x125E) - d.r16(bx + 0x125C)));
    d.w16(bx + 0x12C0, Race.quarterDiff(d.r16(bx + 0x126A) - d.r16(bx + 0x1268)));
    d.w16(bx + 0x12C2, 4);
  }

  /** fn 6ae5: terrain type 4 of round 3 (entering a pocket) and the state 0x0E handler (inside the pocket), phased by
   *  [1382]: 0 enter (state 4), 1 sink and teleport to the pocket queue (state 0x0E, inactive), 2 head-to-head wait,
   *  3 roll towards the exit point, 4 pop out (drawn, launched) and back to state 0. */
  fn6ae5Pocket(bx: number): void {
    const d = this.d;
    const phase = d.r16(bx + 0x1382);
    if (phase === 1) return this.pocketSink(bx);
    if (phase === 2) return this.pocketWait(bx);
    if (phase === 3) return this.pocketRoll(bx);
    if (phase === 4) return this.pocketExit(bx);
    const rec = this.pocketRecord(bx);
    if (rec < 0 || d.rs16(bx + 0x12E7) < d.rs16(rec)) return this.pocketBounce(bx);
    d.w16(bx + 0x12AE, 4); d.w16(bx + 0x1382, 1);
    const di = d.r16(rec + 8);
    d.w16(bx + 0x138C, di);
    const slot = d.r16(di + 0x2688);
    d.add16(di + 0x2688, 2); d.add16(di + 0x2684, 1); d.w16(di + 0x2688, d.r16(di + 0x2688) & 6);
    d.w16(slot + 0x268C + di, bx);
    this.pocketCentre(bx);
  }

  private pocketSink(bx: number): void {                   // 6c01
    const d = this.d;
    if (d.r16(0x2682) === 0xFFFF) d.w16(0x2682, bx);
    d.w16(0x2680, 0xFFFF);
    const rec = this.pocketRecord(bx);
    if (rec < 0 || d.rs16(bx + 0x12E7) < d.rs16(rec)) {   // 6f48: leave the pocket queue, then bounce
      const di = d.r16(bx + 0x138C);
      d.add16(di + 0x2684, -1); d.add16(di + 0x2688, -2);
      return this.pocketBounce(bx);
    }
    d.w16(bx + 0x1260, d.r16(rec + 2)); d.w16(bx + 0x126C, d.r16(rec + 4)); d.w16(bx + 0x1278, d.r16(rec + 6));
    d.w16(bx + 0x127A, d.r16(bx + 0x129C));
    const spd = d.r16(bx + 0x127A);
    const h = d.r16(bx + 0x1278) & 0xF8;
    d.w16(bx + 0x1272, mulfix(d.rs8(0x10A0 + h), spd));
    let si = h - 0x40; if (si <= -1) si += 0x100;
    d.w16(bx + 0x1276, mulfix(d.rs8(0x10A0 + si), spd));
    for (const o of [0x125A, 0x1258, 0x1266, 0x1264, 0x12D0, 0x12D2, 0x12DA, 0x12DC, 0x12B6, 0x12B8, 0x12B0, 0x1282, 0x1284, 0x1286,
      0x128C, 0x1288, 0x128A]) d.w16(bx + o, 0);
    d.w16(bx + 0x128E, 0xFFE2); d.w16(bx + 0x1290, 0x14); d.w16(bx + 0x1292, 0x1E); d.w16(bx + 0x1294, 0xFFEC);
    for (const o of [0x1296, 0x1298, 0x12B2, 0x12B4]) d.w16(bx + o, 0);
    d.m.fill(0xFF, bx + 0x12FD, bx + 0x12FD + 0x60);
    d.m.fill(0xFF, bx + 0x135D, bx + 0x135D + 0x1E);
    d.w16(bx + 0x1382, 2); d.w16(bx + 0x124C, 0); d.w16(bx + 0x12AE, 0x0E);
  }

  private pocketWait(bx: number): void {                   // 6d94
    const d = this.d;
    if (d.r16(0x2656) === 2) {
      const di = d.r16(bx + 0x138C);
      if (d.r16(di + 0x2684) !== 2) {
        d.add16(di + 0x268A, 1);
        if (d.rs16(di + 0x268A) < 0x28) return;
        d.w16(0x2911, 1); d.w16(bx + 0x12AE, 0); d.w16(bx + 0x124C, 1); d.w16(bx + 0x1382, 0);
        return;
      }
      const other = bx === d.r16(0x2660) ? d.r16(0x2662) : d.r16(0x2660);
      if (d.r16(other + 0x12AE) === 4) return;
    }
    this.pocketRoll(bx);
  }

  /** 6df3: move 8*[263a] px per frame towards the exit point; once there and first in the pocket queue, pop out. */
  private pocketRoll(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x1382, 3);
    const cx = (8 * d.r16(0x263A)) & 0xFFFF;
    const tx = d.r16(bx + 0x1260), ty = d.r16(bx + 0x126C);
    if (Math.abs(s16(tx - d.r16(bx + 0x125C))) >= s16(cx)) d.add16(bx + 0x125C, d.rs16(bx + 0x125C) >= s16(tx) ? -cx : cx);
    else d.w16(bx + 0x125C, tx);
    if (Math.abs(s16(ty - d.r16(bx + 0x1268))) >= s16(cx)) { d.add16(bx + 0x1268, d.rs16(bx + 0x1268) >= s16(ty) ? -cx : cx); return; }
    d.w16(bx + 0x1268, ty);
    if (Math.abs(s16(tx - d.r16(bx + 0x125C))) >= s16(cx)) return;
    d.w16(0x2682, 0xFFFF);
    const di = d.r16(bx + 0x138C);
    if (d.r16(d.r16(di + 0x2686) + 0x268C + di) !== bx) return;
    if (d.r16(0x2656) === 2) {
      if (d.r16(0x2680) !== 0xFFFF) {
        const si = d.r16(0x2680);
        if (d.r16(si + 0x12D6) !== 0 || d.r16(si + 0x12D4) !== 0) return;
      }
    } else if (d.r16(0x2680) !== 0xFFFF && d.r16(d.r16(0x2680) + 0x12AE) !== 0) return;
    d.w16(0x2680, bx);
    d.w16(bx + 0x1382, 4); d.w16(bx + 0x124C, 1); d.w16(bx + 0x12D6, 1); d.w16(bx + 0x12D4, 8);
    this.pocketExit(bx);
  }

  /** When a car in phase 3 will pop out (and be drawn) in this frame, the position it is drawn from; used by the
   *  renderer, which runs before the state handlers. Read-only mirror of pocketRoll. */
  pocketPopOutPreview(bx: number): { x: number; y: number } | undefined {
    const d = this.d;
    const cx = s16(8 * d.r16(0x263A));
    const tx = d.r16(bx + 0x1260), ty = d.r16(bx + 0x126C);
    let x = d.rs16(bx + 0x125C);
    const y = d.rs16(bx + 0x1268);
    if (Math.abs(s16(tx - x)) >= cx) x = s16(x >= s16(tx) ? x - cx : x + cx); else x = s16(tx);
    if (Math.abs(s16(ty - y)) >= cx) return undefined;
    if (Math.abs(s16(tx - x)) >= cx) return undefined;
    const di = d.r16(bx + 0x138C);
    if (d.r16(d.r16(di + 0x2686) + 0x268C + di) !== bx) return undefined;
    if (d.r16(0x2656) === 2) {
      if (d.r16(0x2680) !== 0xFFFF) { const si = d.r16(0x2680); if (d.r16(si + 0x12D6) !== 0 || d.r16(si + 0x12D4) !== 0) return undefined; }
    } else if (d.r16(0x2680) !== 0xFFFF && d.r16(d.r16(0x2680) + 0x12AE) !== 0) return undefined;
    return { x: x & 0xFFFF, y: s16(ty) & 0xFFFF };           // drawn from the moved position with [12d6] = 1
  }

  private pocketExit(bx: number): void {                   // 6efa
    const d = this.d;
    this.fn7d73Visibility(bx);
    if (Math.abs(s16(d.r16(bx + 0x1260) - d.r16(bx + 0x125C))) > 0x32) return;
    const di = d.r16(bx + 0x138C);
    d.add16(di + 0x2686, 2); d.add16(di + 0x2684, -1); d.w16(di + 0x2686, d.r16(di + 0x2686) & 6);
    d.w16(bx + 0x1382, 0); d.w16(bx + 0x12AE, 0); d.w16(di + 0x268A, 0);
  }

  /** State 4 (fn 7f62): pulled to the pocket centre, then the sink animation (table ds:2879) and into the pocket. */
  fn7f62Pocketed(bx: number): void {
    const d = this.d;
    if (d.r16(0x2682) === 0xFFFF) d.w16(0x2682, bx);
    if (d.r16(bx + 0x12C2) !== 0) return this.fn7d73Visibility(bx);
    const si = 0x2879 + d.r16(bx + 0x12B6) * 2;
    const ax = d.r16(si), frame = d.r16(si + 0x12);
    if (frame === 0xFFFF) {
      d.w16(bx + 0x12B6, 0); d.w16(bx + 0x12B0, 0); d.w16(bx + 0x124C, 0); d.w16(bx + 0x1382, 1);
      d.w16(bx + 0x12AE, 0x0E); d.w16(bx + 0x1380, 1); d.w16(bx + 0x137E, 0);
      return;
    }
    if (d.rs16(bx + 0x12B0) < s16(ax)) return;
    d.add16(bx + 0x12B6, 1);
    if (d.r16(bx + 0x12B6) === 4 && d.r16(bx + 0x1250) !== 0) this.snd(5, 8);
  }

  /** State 5 (fn 7efa): bounced off a closed pocket: knockback, animation (table ds:2855), then state 7. */
  fn7efaBounce(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x12C2) !== 0) return this.fn7d73Visibility(bx);
    const si = 0x2855 + d.r16(bx + 0x12B6) * 2;
    const ax = d.r16(si), frame = d.r16(si + 0x12);
    if (frame === 0xFFFF) { d.w16(bx + 0x12B6, 0); d.w16(bx + 0x12AE, 7); d.w16(bx + 0x12B0, 0); d.w16(bx + 0x1382, 0); return; }
    if (d.rs16(bx + 0x12B0) < s16(ax)) return;
    d.add16(bx + 0x12B6, 1);
    if (d.r16(bx + 0x12B6) === 4 && d.r16(bx + 0x1250) !== 0) this.snd(5, 8);
  }

  /** State 0x0A: start-line countdown. Car 0 advances [26d5] by the smoothness value per rendered frame. */
  fn849bCountdown(bx: number): void {
    const d = this.d;
    d.w16(0x26CA, 1);
    const car0 = d.r16(0x2660);
    if (d.r16(0x2656) !== 2 && bx !== car0) {
      if (d.r16(0x12AE) === 0x0A) return this.fn7d73Visibility(bx);
      d.w16(bx + 0x12AE, 0); return;
    }
    const cx = d.r16(0x263A);
    if (bx === car0) d.add16(0x26D5, cx);
    if (d.rs16(0x26D5) >= 0x60) {
      for (const o of [0x12AE, 0x1412, 0x1576, 0x16DA]) d.w16(o, 0);
      d.w16(0x264E, 0x32); d.w16(0x2650, 0x32); d.w16(0x26CA, 0);
    } else if (d.r8(0x26CF) === 1) return;
    this.fn7d73Visibility(bx);
    if (bx === car0 && d.r16(bx + 0x1250) !== 0) this.snd(5, 9);
  }

  /** State 1: car captured (whirlpool / pulled to a cell centre): frame table animation, then state 7. */
  fn880aPulled(bx: number): void {
    const d = this.d;
    d.w16(bx + 0x127A, 0);
    const rnd = this.round;
    let base: number, stride: number;
    if (rnd === 9 || rnd === 4) {
      const h = d.r16(bx + 0x1278) & 0xF8;
      if (h === 0) {
        if (d.r16(bx + 0x12C2) !== 0) return this.fn7d73Visibility(bx);
        base = 0x27C1; stride = 0x0E;
      } else if (h === 0x80) {
        if (d.r16(bx + 0x12C2) !== 0) return this.fn7d73Visibility(bx);
        base = 0x27DD; stride = 0x0E;
      } else {
        if (h < 0x40 || (h > 0x80 && h <= 0xC0)) d.add16(bx + 0x1278, -4); else d.add16(bx + 0x1278, 4);
        return this.fn7d73Visibility(bx);
      }
    } else {
      if (d.r16(bx + 0x12C2) !== 0) return this.fn7d73Visibility(bx);
      [base, stride] = rnd === 2 ? [0x2835, 0x10] : [0x27F9, 0x1E];
    }
    const si = base + d.r16(bx + 0x12B6) * 2;
    const ax = d.r16(si), frame = d.r16(si + stride);
    if (frame === 0xFFFF) { d.w16(bx + 0x12B6, 0); d.w16(bx + 0x12AE, 7); d.w16(bx + 0x12B0, 0); return; }
    // frame != -2: fn 7fe8 / 8034 draw the animation frame (no data-segment writes)
    if (d.rs16(bx + 0x12B0) < s16(ax)) return;
    d.add16(bx + 0x12B6, 1);
    if (rnd === 4 || rnd === 9 || rnd === 2) { if (d.r16(bx + 0x12B6) === 4 && d.r16(bx + 0x1250) !== 0) this.snd(5, 0x11); }
    else if (d.r16(bx + 0x12B6) === 8 && d.r16(bx + 0x1250) !== 0) this.snd(5, 7);
  }

  /** States 2 and 0x0D: respawn animation driven by the duration table at ds:289d. */
  fn82beRespawn(bx: number): void {
    const d = this.d;
    const si = 0x289D + d.r16(bx + 0x12B8) * 2;
    const ax = d.r16(si), frame = d.r16(si + 0x0E);
    if (frame === 0xFFFE) { /* no draw */ }
    else if (frame === 0xFFFF) {
      d.w16(bx + 0x12B8, 0); d.w16(bx + 0x12B0, 0);
      if (d.r16(bx + 0x12AE) === 0x0D) d.w16(bx + 0x12AE, 7);
      else { d.w16(bx + 0x12AE, 0); d.w16(0x2911, 0); this.fn7d73Visibility(bx); }
      d.w16(bx + 0x12AA, 0); return;
    } else if (d.r16(bx + 0x12AE) !== 2) { if (d.rs16(bx + 0x12B8) <= 3) this.fn7d73Visibility(bx); }
    else if (d.rs16(bx + 0x12B8) >= 3) this.fn7d73Visibility(bx);
    if (d.rs16(bx + 0x12B0) >= s16(ax)) d.add16(bx + 0x12B8, 1);
    d.w16(bx + 0x12AA, 0);
  }

  /** State 7: put the car back at the centre of its last safe 96x96 block, facing the block's LEV direction,
   *  then hand over to the respawn animation (state 2). */
  fn6febReappear(bx: number): void {
    const d = this.d;
    if (this.round === 2 || this.round === 8) {
      d.add16(bx + 0x1382, -1);
      if (d.rs16(bx + 0x1382) > 0) return;
    }
    if (d.r8(0x28C1) === 0x16 && d.r16(bx + 0x12CC) === 4) d.add16(bx + 0x12F3, -0x60);
    if (d.r16(0x2656) === 2) {
      const di = d.r16(bx + 0x138C);
      for (const o of [0x268A, 0x2686, 0x2688, 0x2684]) d.w16(di + o, 0);
    }
    d.w16(bx + 0x129C, d.r16(bx + 0x129E));
    for (const o of [0x127A, 0x1272, 0x1270, 0x125A, 0x1258, 0x1276, 0x1274, 0x1266, 0x1264, 0x12D0, 0x12D2, 0x12DA, 0x12DC]) d.w16(bx + o, 0);
    let x = Math.floor(d.r16(bx + 0x12F1) / 0x60) * 0x60 + 0x30, y = Math.floor(d.r16(bx + 0x12F3) / 0x60) * 0x60 + 0x30;
    d.w16(bx + 0x125C, x); d.w16(bx + 0x1268, y);
    let c = this.fn589cCol(x, y);
    const lev = d.r8(d.r16(0x28B9) + c.block);
    let si = 0x1FCB + (lev & 0x1C); const variant = (lev >> 5) & 3;
    x = this.wrapPos(d.rs16(si) + x); y = this.wrapPos(d.rs16(si + 2) + y);
    d.w16(bx + 0x125C, x); d.w16(bx + 0x125E, x); d.w16(bx + 0x1268, y); d.w16(bx + 0x126A, y);
    c = this.fn589cCol(x, y);
    d.w16(bx + 0x12E3, c.prog); d.w16(bx + 0x12E1, c.prog); d.w16(bx + 0x12CC, c.block);
    const lst = this.checkpointList(); let c2 = 0;
    // the bound is the port's alone: a damaged track list with no entry above the car's progress would
    // otherwise walk the whole data segment. The 0xffff terminator already ends it for every valid track.
    for (; c2 < 0x200; c2 += 2) { const v = d.r16(lst + c2); if ((c.prog & 0xFF) < (v & 0xFF)) break; }
    d.w16(bx + 0x12E7, c2);
    if (c.block === 0x1A) d.w16(bx + 0x1388, 0);
    d.w16(bx + 0x12DE, c.mapbits); d.w16(bx + 0x12CE, c.cell);
    let ax = [0x40, 0x80, 0x60, 0xA0][variant]!;
    if (c.mapbits & 2) ax ^= 0x80;
    if (c.mapbits & 1) ax ^= 0x80;
    d.w16(bx + 0x1278, ax);
    // 71b8: nudge 12 px along the heading (player: forward, others: backward)
    si = d.r16(bx + 0x1278) & 0xF8;
    if (bx === d.r16(0x2660)) { si += 0x40; if (si >= 0x100) si -= 0x100; }
    else { si -= 0x40; if (si <= -1) si += 0x100; }
    si += 0x10A0;
    x = s16(mulfix(d.rs8(si), 0xC)) + d.rs16(bx + 0x125C);
    si = si + 1 - 0x41;
    if (si <= 0x109F) si += 0x100;
    y = s16(mulfix(d.rs8(si), 0xC)) + d.rs16(bx + 0x1268);
    x = this.wrapPos(x); y = this.wrapPos(y);
    d.w16(bx + 0x125C, x); d.w16(bx + 0x125E, x); d.w16(bx + 0x1268, y); d.w16(bx + 0x126A, y);
    d.w16(bx + 0x12AE, 2);
    d.w16(bx + 0x12BA, x); d.w16(bx + 0x12BC, y);
    d.w16(bx + 0x1380, 1); d.w16(bx + 0x137E, 0);
    for (const o of [0x12B6, 0x12B8, 0x12B0, 0x12D6, 0x12D4]) d.w16(bx + o, 0);
    d.w16(bx + 0x12D8, 1);
    for (const o of [0x1282, 0x1284, 0x1286, 0x128C, 0x1288, 0x128A]) d.w16(bx + o, 0);
    d.w16(bx + 0x128E, 0xFFE2); d.w16(bx + 0x1290, 0x14); d.w16(bx + 0x1292, 0x1E); d.w16(bx + 0x1294, 0xFFEC);
    for (const o of [0x1270, 0x1274, 0x1272, 0x1276]) d.w16(bx + o, 0);
    d.w16(bx + 0x138A, 1);
    d.w16(d.r16(bx + 0x138C) + 0x268A, 0);
    d.w16(bx + 0x1382, 0);
    for (const o of [0x26BC, 0x26C2, 0x26BE, 0x26C0]) d.w16(o, 0);
    if (d.r16(bx + 0x1250) !== 0) this.snd(5, 9);
    d.w16(bx + 0x1296, 0); d.w16(bx + 0x1298, 0); d.w16(bx + 0x1384, 0);
    d.w16(bx + 0x12B2, 0); d.w16(bx + 0x12B4, 0);
    for (let o = 0x12FD; o < 0x12FD + 0x60; o += 2) d.w16(bx + o, 0xFFFF);
    for (let o = 0x135D; o < 0x135D + 0x1E; o += 2) d.w16(bx + o, 0xFFFF);
    d.w16(0x264E, 8); d.w16(0x2650, 8);
    this.fn585bDir(bx); this.fn585bDir(bx);
    if (this.round === 4 || this.round === 5) {
      const t = d.r16(bx + 0x12DA) >> 4;
      if (t >= 5) d.w16(bx + 0x138E, t === 0x0D ? 0xFFFF : t === 0x0E ? 4 : t - 4);
    }
    if (d.r16(0x2656) === 2) {
      const a = d.r16(0x2660), b = d.r16(0x2662);
      const m = Math.min(d.rs16(a + 0x12ED), d.rs16(b + 0x12ED));
      d.w16(a + 0x12ED, m); d.w16(b + 0x12ED, m);
    }
  }

  /** Skid-mark ring (5 x 6 B at [135d]). Quirk kept: a new entry always lands in slot 0 while the index advances. */
  fn8386Skids(bx: number): void {
    const d = this.d;
    if (d.rs16(bx + 0x1298) > 0) {
      for (let dx = 0; dx < 0x1E; dx += 6) {
        const p = bx + dx;
        if (d.r16(p + 0x1361) === 0xFFFF) continue;
        if (d.rs16(bx + 0x12B2) > 0) continue;
        d.add16(p + 0x1361, 1);
        if (d.rs16(p + 0x1361) >= 5) d.w16(p + 0x1361, 0xFFFF);
      }
    }
    if (d.r16(bx + 0x128C) === 0 || d.rs16(bx + 0x12B4) > 0) return;
    d.w16(bx + 0x12B4, 6); d.w16(bx + 0x128C, 0);
    d.w16(bx + 0x135D, d.r16(bx + 0x125C)); d.w16(bx + 0x135F, d.r16(bx + 0x1268)); d.w16(bx + 0x1361, 0);
    d.add16(bx + 0x1298, 6);
    if (d.r16(bx + 0x1298) >= 0x1E) d.add16(bx + 0x1298, -0x18);
    d.w16(bx + 0x12B4, 6);
  }

  /** Tyre-track ring (8 x 12 B at [12fd]): age entries, emit a pair of points behind the wheels. */
  fn8083Tracks(bx: number): void {
    const d = this.d;
    if (d.rs16(bx + 0x1296) > 0) {
      for (let dx = 0; dx < 0x60; dx += 12) {
        const p = bx + dx;
        if (d.r16(p + 0x1305) === 0xFFFF) continue;
        if (d.rs16(bx + 0x12B2) < 1) {
          d.add16(p + 0x1305, 1);
          if (d.rs16(p + 0x1305) > 7) d.w16(p + 0x1305, 0xFFFF);
        }
      }
    }
    if (d.rs16(bx + 0x12B2) >= 1) return;
    d.w16(bx + 0x12B2, 3);
    let img: number;
    if (d.r16(bx + 0x1284) === 0) {
      if (d.r16(bx + 0x1288) === 0) {
        if (d.r16(bx + 0x128A) === 0) return;
        d.w16(bx + 0x128A, 0); img = 0x3FE3;
      } else { d.w16(bx + 0x1288, 0); img = 0x41E3; }
    } else {
      if (d.r16(bx + 0x1272) === 0 && d.r16(bx + 0x1276) === 0) return;
      img = 0x43E3;
    }
    const point = (offA: number, offB: number, delta: number): [number, number] => {
      let x = d.rs16(bx + 0x125C), y = d.rs16(bx + 0x1268);
      let ang: number;
      if (this.round === 2) {
        ang = (d.r16(bx + 0x1278) + d.r16(bx + offA)) & 0xFF;
        let v = (d.r16(bx + offA) + d.r16(bx + offB)) & 0xFFFF;
        d.w16(bx + offA, v);
        if (v > 0x7FFF) v = (-v) & 0xFFFF;
        if (s16(v) > 0x1D) d.w16(bx + offB, -d.rs16(bx + offB));
      } else ang = (d.r16(bx + 0x1278) + delta) & 0xFFFF;
      const a = (ang + 0x80) & 0xFF;
      x = (x + (d.rs8(0x10A0 + a) >> 4)) & 0xFFFF;
      y = y + (d.rs8(0x10A0 + ((a - 0x40) & 0xFF)) >> 4);
      if (x > 0x7FFF) x = (x + 0xC00) & 0xFFFF;
      if (s16(x) > 0xBFF) x = (x - 0xC00) & 0xFFFF;
      if (y < -0xB) y += 0xC00;
      if (y > 0xBFF) y -= 0xC00;
      return [x, y & 0xFFFF];
    };
    const slot = bx + d.r16(bx + 0x1296);
    let [x, y] = point(0x128E, 0x1290, -0x1E);
    d.w16(slot + 0x12FD, x); d.w16(slot + 0x12FF, y); d.w16(slot + 0x1305, 0); d.w16(slot + 0x1307, img);
    [x, y] = point(0x1292, 0x1294, 0x1E);
    d.w16(slot + 0x1301, x); d.w16(slot + 0x1303, y);
    d.add16(bx + 0x1296, 12);
    if (d.r16(bx + 0x1296) > 0x5F) d.add16(bx + 0x1296, -0x54);
    d.w16(bx + 0x12B2, 3);
  }

  fn8712Particles(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x1394) !== 0) { if (d.r16(bx + 0x1396) < 5) d.add16(bx + 0x1396, 1); }
    d.add16(bx + 0x13A4, -1);
    if (d.r16(bx + 0x13A4) === 0) d.w16(bx + 0x1394, 0);
  }

  // ---------------------------------------------------------------- post-render per car (7429 / 73e7 / 51b2)
  fn7429Jump(bx: number): void {
    const d = this.d;
    if (this.round === 9 && d.r16(0x26CA) === 0) {
      d.add16(0x26C8, -1);
      if (d.r16(0x26C8) === 0) {
        if (d.r16(bx + 0x1250) !== 0) this.snd(5, 0x0F);
        d.w16(0x26CA, 1); d.w16(0x12AE, 0x10);
      }
    }
    if (d.rs16(bx + 0x12B2) > 0) d.add16(bx + 0x12B2, -1);
    if (d.rs16(bx + 0x12B4) > 0) d.add16(bx + 0x12B4, -1);
    if (d.r16(bx + 0x124C) === 0) return;
    if (d.rs16(bx + 0x12D6) > 0) {
      d.add16(bx + 0x12D6, d.rs16(bx + 0x12D4) >> 2);
      d.add16(bx + 0x12D4, -1);
      if (d.rs16(bx + 0x12D6) > 0) return;
      if (this.round === 2) d.w16(bx + 0x128C, 1);
      if (d.r16(bx + 0x1384) !== 0) { this.respawn(bx); d.w16(bx + 0x1384, 0); }
      if (d.r16(bx + 0x12D8) !== 0) {
        d.w16(bx + 0x12D4, -d.rs16(bx + 0x12D4));
        d.add16(bx + 0x12D4, -d.rs16(0x24FF + this.round * 2));
      } else { d.w16(bx + 0x12D4, 0); d.w16(bx + 0x12D6, 0); d.w16(bx + 0x12D8, 1); }
      if (d.r16(0x0F64) === 1 && d.r16(bx + 0x1250) !== 0) this.snd(5, this.round === 2 ? 7 : 4);
      return;
    }
    if (d.rs16(bx + 0x12D4) > 0) {
      d.add16(bx + 0x12D6, d.r16(bx + 0x12D4) >> 2);
      d.add16(bx + 0x12D4, -1);
      if (d.r16(0x0F64) === 1 && d.r16(bx + 0x1250) !== 0) this.snd(5, this.round === 2 ? 7 : 4);
      return;
    }
    d.w16(bx + 0x12D6, 0);
    if (d.r16(0x2656) !== 2) return;
    this.fn75d2(bx);
  }

  fn73e7Knockback(bx: number): void {
    const d = this.d;
    if (this.round === 9 && bx !== 0) return;
    d.add16(bx + 0x12B0, 1);
    const st = d.r16(bx + 0x12AE);
    if ((st === 1 || st === 4 || st === 5) && d.r16(bx + 0x12C2) !== 0) {
      d.add16(bx + 0x12C2, -1);
      d.add16(bx + 0x125C, d.r16(bx + 0x12BE)); d.add16(bx + 0x1268, d.r16(bx + 0x12C0));
    }
  }

  fn51b2Particles(bx: number): void {
    const d = this.d;
    if (d.r16(bx + 0x13A4) === 0) return;
    d.add16(bx + 0x13A4, -1);
    if (d.r16(bx + 0x13A4) < 0x28) return;
    if (d.r16(bx + 0x1396) < 5) d.add16(bx + 0x1396, 1);
    for (const [pos, vel] of [[0x1398, 0x13A0], [0x139C, 0x13A2]] as const) {
      let ax = d.r16(bx + vel), cx = d.r16(bx + pos);
      for (let i = 0; i < 6; i++) [ax, cx] = Race.fn87f3(ax, cx);
      ax = (ax & 0xF0FF) | (d.r16(bx + vel) & 0xF00);
      d.w16(bx + vel, ax);
      d.w16(bx + pos, cx + s8(((ax >> 8) & 0xF) - 8));
    }
    if (d.r16(bx + 0x139A) !== 0) { d.add16(bx + 0x139A, -1); d.add16(bx + 0x139E, -1); }
  }

  private static fn87f3(ax: number, cx: number): [number, number] {
    let al = ax & 0xFF, ah = (ax >> 8) & 0xF0;
    if (al & 0x80) {
      al = (-al) & 0xFF;
      const r = ah - al;
      if (r < 0) cx = (cx - 1) & 0xFFFF;
      ah = r & 0xFF;
      al = (-al) & 0xFF;
    } else {
      const r = ah + al;
      if (r > 0xFF) cx = (cx + 1) & 0xFFFF;
      ah = r & 0xFF;
    }
    return [(ah << 8) | al, cx];
  }

  // ---------------------------------------------------------------- one logic step (fn 3039 body)
  /** fn 3039 prologue (3055..3064): run once when the race loop starts. */
  raceLoopInit(): void { this.d.w16(0x2621, 0xFFFF); this.d.w16(0x2638, this.d.r16(0x263A)); }

  /** First half of a loop iteration: input poll and physics (3067..3093). */
  stepPhysics(keys1: number, keys2 = 0): void {
    const d = this.d;
    this.fn2d5bInput(keys1, keys2);
    if (d.r8(0x107C) & 2) return this.fn35f0();                // the pause key (Space in the shipped settings)
    this.fn4aee();
    if (d.rs16(0x26C6) >= 2) {                                 // 3081..3093: the race is decided, run the 100-step grace period
      if (d.r16(0x2656) === 2) { this.fn7af8(); this.over = true; return; }   // 30df: no grace period in a head to head
      d.add16(0x26CC, -1);
      if (d.r16(0x26CC) === 0) this.over = true;              // 30df: sound, then 100 ticks with the last frame held, then exit
    }
  }

  /** Set when the loop has left for the end sequence (fn 30df); the last presented frame stays on screen. */
  over = false;

  /** True when fn 90c5 renders in this iteration (last step of a displayed frame). */
  get rendersThisStep(): boolean { return !this.over && this.d.r16(0x2638) === 1; }

  /** Second half of a loop iteration: per-car post-render updates and the frame pacing counter. */
  stepPost(): void {
    const d = this.d;
    for (const bx of CARS) {
      this.fn7429Jump(bx);
      if (d.r16(bx + 0x12AE) !== 0) this.fn73e7Knockback(bx);
      this.fn51b2Particles(bx);
    }
    d.add16(0x2638, -1);
    if (d.r16(0x2638) === 0) d.w16(0x2638, d.r16(0x263A));   // frame presented here (fn 92bc)
  }

  /** One iteration of the fn 3039 loop body. The game runs [263a] of these per displayed frame. */
  step(keys1: number, keys2 = 0): void {
    this.stepPhysics(keys1, keys2);
    if (this.over) return;                                    // 30df: nothing else runs in the exiting iteration
    if (this.rendersThisStep) this.renderSideEffects();      // fn 90c5 draws only on the last step of a frame
    this.stepPost();
  }
}
