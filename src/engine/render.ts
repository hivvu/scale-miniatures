/**
 * Race renderer: transliteration of fn 90c5 (tile layer with fine scroll, sprite pass fn 7ce0, deferred
 * priority tiles) and the VRAM copy fn 92bc. Draws into a 64 KB image of the back-buffer segment (6D78,
 * stride 0x110) and produces the 320x200 indexed frame the game copies to A000:0020.
 * See re/notes/60-tiles-blit.md and 61-sprites.md.
 */
import { DataSegment, s16 } from './memory';
import { CARS } from './race';
import { DOS_VIEWPORT, type Viewport } from './viewport';

export interface RenderSources {
  ds: DataSegment;
  /** 192x192 tile words as the game holds them at segments 3B78..4478 (see data/blocks expandMap). */
  mapWords: Uint16Array;
  /** PR0|PR1|PR2 concatenated: tile n at byte n*256 (segment 1B78 onwards). */
  banks: Uint8Array;
  /** 32-frame vehicle table as at segment 4D78 (data/sprites frameTableBytes). */
  vehicle: Uint8Array;
  /** Extra animation frames as at segment 5D78: VH0 image from 0x1440 (12 x 24x24) or 0x3840 in round 9 (5 x 40x40). */
  extra?: Uint8Array | undefined;
  /** How much of the world to draw. Defaults to the original's 256x200; see engine/viewport.ts. */
  viewport?: Viewport | undefined;
}

/** Race init (fn 37fc, 397f..39e6): in GAME1 rounds 2 and 3 the game marks tile words of "overhead" tiles as
 *  priority (bit 15) so they are drawn over the sprites. Only the first 0x4706 words of each 96-row half are
 *  processed (the original's loop count), which leaves the last 1.3 rows of each half unflagged. */
export function applyPriorityFlags(mapWords: Uint16Array, round: number, game1 = true): void {
  if (!game1) return;
  let lo: number, hi: number;
  if (round === 2) { lo = 0x40; hi = 0x13C; }
  else if (round === 3) { lo = 1; hi = 0x51; }
  else return;
  for (const half of [0, 96 * 192]) {
    for (let i = 0; i < 0x4706; i++) {
      const w = mapWords[half + i]!;
      if (w >= lo && w <= hi) mapWords[half + i] = w | 0x8000;
    }
  }
}

export class RaceRenderer {
  /** Back buffer (segment 6D78 at the original size). */
  readonly back: Uint8Array;
  readonly vp: Viewport;
  /** Cached from the viewport: these are read in the innermost blit loops. */
  private readonly stride: number;
  private readonly mask: number;
  private readonly origin: number;
  private readonly bufSize: number;
  /** cs:[8994]: fine x residue (0..3) applied when copying to VRAM. */
  fineX = 0;
  private deferred: { di: number; tile: number }[] = [];

  /** Optional engine reference for read-only previews of what a state handler will draw this frame. */
  race: {
    pocketPopOutPreview(bx: number): { x: number; y: number } | undefined;
    /** fn 851f / 855a / 8634 (head to head): what the last renderSideEffects asked for. */
    readonly banner?: { src: number; x: number; y: number } | undefined;
  } | undefined;

  constructor(private readonly src: RenderSources) {
    this.vp = src.viewport ?? DOS_VIEWPORT;
    this.back = new Uint8Array(this.vp.bufSize);
    this.stride = this.vp.stride;
    this.mask = this.vp.mask;
    this.origin = this.vp.origin;
    this.bufSize = this.vp.bufSize;
  }

  /** Screen (x, y) to a back-buffer offset. */
  private at(x: number, y: number): number { return this.origin + y * this.stride + x; }

  /** fn 90c5 body (called when [2638] == 1). Returns the 320x200 frame (A000 image).
   *  `sideEffects` is Race.renderSideEffects: the state changes fn 90c5 makes (skid/foam emitters, state handlers,
   *  ranking sort). The original interleaves them with the drawing; the sprite lists are drawn as they are before
   *  the emitters add this frame's entries, and the HUD reads the ranking after the sort. */
  render(sideEffects?: () => void): Uint8Array {
    this.animatedTiles();
    this.tileLayer();
    this.spritePass();
    this.deferredTiles();
    sideEffects?.();
    this.hud();
    this.banners();
    return this.copyToVram();
  }

  // ---------------------------------------------------------------- animated tiles (90d9..9107)
  /** Round 2, fn 89e0: the plughole is a 4x4 block of map words (rows 181..184, cols 99..102) cycled through the tile
   *  sets 0x00 / 0x10 / 0x20 / 0x30 every 4 rendered frames of [26d1]. The counter itself is incremented in
   *  Race.renderSideEffects (which runs after the tile layer here), so the value it will have is used.
   *  Round 8 (fn 8a2b) cycles 3x3 blocks of map words on tracks 2 and 3. */
  private animatedTiles(): void {
    const d = this.src.ds;
    const round = d.r8(0x28BF);
    if (round === 1 || round === 3 || round === 5) {
      // fn 8996: tile 0 (water) = its saved copy at ds:3ee3 rotated by ((camX & 0x1f) >> 1, (camY & 0x1f) >> 1)
      const dx = (d.r16(0x264A) & 0x1F) >> 1, dy = (d.r16(0x264C) & 0x1F) >> 1;
      for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) this.src.banks[((r + dy) & 0xF) * 16 + ((c + dx) & 0xF)] = d.m[0x3EE3 + r * 16 + c]!;
    } else if (round === 2) {
      const phase = ((d.r16(0x26D1) + 1) >> 2) & 3;
      let tile = phase * 0x10;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) this.src.mapWords[(181 + r) * 192 + 99 + c] = tile++;
    }
    else if (round === 8) {
      // fn 8a2b: 3x3 blocks of map words cycle through tile sets 0 / 9 / 0x12 by phase ([26d3] >> 2) & 3 (phase 3
      // resets the counter and uses set 0); track 1 has none, track 2 one block, track 3 six.
      const track = d.r8(0x28C0);
      if (track === 1) return;
      const phase = ((d.r16(0x26D3) + 1) >> 2) & 3;
      const base = phase === 1 ? 9 : phase === 2 ? 0x12 : 0;
      const blocks: [number, number][] = track === 3 ? [[62, 98], [68, 90], [80, 90], [86, 90], [104, 90], [110, 90]] : [[68, 18]];
      for (const [row, col] of blocks) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.src.mapWords[(row + r) * 192 + col + c] = base + r * 3 + c;
    }
  }

  // ---------------------------------------------------------------- tiles (9107..91ed)
  private tileLayer(): void {
    const d = this.src.ds;
    const camX = d.r16(0x264A), camY = d.r16(0x264C);
    let dl = (camX >> 4) & 0xFF;                   // first tile column (mod 256, wraps at 0xC0)
    const dh = (dl + this.vp.cols) & 0xFF;         // one column more than the view needs
    let di = this.vp.margin - (camX & 0xF);
    let bl = (camY >> 4) & 0xFF;                   // first tile row
    const bh = (bl + this.vp.rows) & 0xFF;         // one row more than the view needs
    const yoff = this.vp.margin - (camY & 0xF);
    di = (di + yoff * this.stride) & this.mask;
    this.fineX = di & 3;
    di -= this.fineX;                               // was `di &= 0xfffc`: identical at 16 bits, correct at any buffer size
    let col = dl, row = bl;                        // map indices (0..191)
    this.deferred = [];
    const rowStart = (r: number): number => (r % 192) * 192;
    for (;;) {
      let colDi = di;
      for (let c = 0; c < this.vp.cols; c++) {
        const mapCol = (col + c) % 192;
        const word = this.src.mapWords[rowStart(row) + mapCol]!;
        const tile = word & 0x7FFF;
        if (word & 0x8000) this.deferred.push({ di: colDi, tile });
        this.blitTile(tile, colDi);
        colDi = (colDi + 16) & this.mask;
      }
      di = (di + 16 * this.stride) & this.mask;
      row = (row + 1) % 192;
      bl = (bl + 1) & 0xFF;
      if (bl === bh) break;
    }
    void dh; void dl;
  }

  private blitTile(tile: number, di: number): void {
    const base = tile * 256;
    if (base + 256 > this.src.banks.length) return;   // stale memory in the original; nothing sensible to copy
    for (let y = 0; y < 16; y++) {
      const dst = (di + y * this.stride) & this.mask;
      if (dst + 16 <= this.bufSize) this.back.set(this.src.banks.subarray(base + y * 16, base + y * 16 + 16), dst);
      else for (let x = 0; x < 16; x++) this.back[(dst + x) & this.mask] = this.src.banks[base + y * 16 + x]!;
    }
  }

  // ---------------------------------------------------------------- deferred priority tiles (9214)
  private deferredTiles(): void {
    for (let i = this.deferred.length - 1; i >= 0; i--) {   // popped in reverse order
      const { di, tile } = this.deferred[i]!;
      const base = tile * 256 + 0xC00;                       // si = 0xC00: the overlay lives 12 tiles later
      if (base + 256 > this.src.banks.length) continue;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const px = this.src.banks[base + y * 16 + x]!;
        if (px !== 0) this.back[(di + y * this.stride + x) & this.mask] = px;
      }
    }
  }

  // ---------------------------------------------------------------- sprites (fn 7ce0)
  private spritePass(): void {
    const d = this.src.ds;
    const round = d.r8(0x28BF);
    // 1. shadows (fn 7e5c) for cars in the air
    for (const bx of CARS) if (d.r16(bx + 0x124C) !== 0 && d.r16(bx + 0x12D6) !== 0) this.shadow(bx, round);
    // 2. skid marks / tyre tracks (drawing halves of fn 8386 / 8083); images live in BITSFILE.PH0 at ds:3fe3
    for (const bx of CARS) { this.skidMarks(bx); this.tyreTracks(bx); }
    // 3. particles (fn 8712 drawing): splash / thrown-up bits with a shadow while high
    for (const bx of CARS) if (d.r16(bx + 0x13A4) !== 0) this.particle(bx);
    // 4. state handlers: only the plain car sprite draw (fn 7d73) is rendered here
    for (const bx of CARS) {
      const st = d.r16(bx + 0x12AE);
      if (!(st === 0x0E || d.r16(bx + 0x124C) !== 0)) continue;
      if (st === 0 || st === 0x0B || st === 0x0C) this.car(bx, round);
      else if (st === 0x0A) {
        // countdown: car 0 (and the others while car 0 is still in state 0x0A) are drawn unless blinking
        const car0 = d.r16(0x2660);
        if (bx !== car0) { if (d.r16(0x12AE) === 0x0A) this.car(bx, round); }
        else if (d.r8(0x26CF) !== 1 || d.rs16(0x26D5) >= 0x60) this.car(bx, round);
      }
      else if (st === 1) this.pulledAnim(bx, round);
      else if (st === 2 || st === 0x0D) this.respawnAnim(bx);
      else if (st === 0x0F || st === 0x10) this.car(bx, round);          // fn 86d2 draws the car; its banner follows the side effects
      else if (st === 4 || st === 5) this.tableAnim(bx, round, st === 4 ? 0x2879 : 0x2855);
      else if (st === 0x0E) {                                          // round 3 pocket: drawn only while popping out
        const phase = d.r16(bx + 0x1382);
        if (phase === 4) this.car(bx, round);
        else if (phase === 3) { const p = this.race?.pocketPopOutPreview(bx); if (p) this.car(bx, round, { ...p, dz: 1 }); }
      }
      // 7d49..7d65: finishing position marker above the car once it has no laps left (or the race is over)
      if (round !== 9 && d.r16(0x2656) !== 2 && (d.rs16(0x26C6) >= 2 || d.r16(bx + 0x12ED) === 0)) this.rankMarker(bx);
    }
  }

  /** fn 9076: 16x8 position marker (ds:5ce3 + (rank-1)*128) above the car, plain blit. */
  private rankMarker(bx: number): void {
    const d = this.src.ds;
    const src = 0x5CE3 + ((d.r16(bx + 0x12EF) - 1) << 7);
    const dz = d.rs16(bx + 0x12D6);
    let x = d.rs16(bx + 0x125C) - dz - 8, y = d.rs16(bx + 0x1268) - dz - 0x14;
    x -= d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
    y -= d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
    const c = this.clip(s16(x), s16(y), 0x10, 8);
    if (c) this.blitFromDs(src + c.srcOff, c.di, c.w, c.h, c.skip);
  }

  /** fn 880a drawing: captured/sinking animation from the extra sprite bank (fn 7fe8: 24x24 recoloured; round 9 fn
   *  8034: 40x40 plain), or the plain car while the heading is still being turned / [12c2] is set. */
  private pulledAnim(bx: number, round: number): void {
    const d = this.src.ds;
    let base: number, stride: number;
    if (round === 9 || round === 4) {
      const h = d.r16(bx + 0x1278) & 0xF8;
      if (h === 0) { if (d.r16(bx + 0x12C2) !== 0) return this.car(bx, round); base = 0x27C1; stride = 0x0E; }
      else if (h === 0x80) { if (d.r16(bx + 0x12C2) !== 0) return this.car(bx, round); base = 0x27DD; stride = 0x0E; }
      else return this.car(bx, round);
    } else {
      if (d.r16(bx + 0x12C2) !== 0) return this.car(bx, round);
      [base, stride] = round === 2 ? [0x2835, 0x10] : [0x27F9, 0x1E];
    }
    const frame = d.r16(base + d.r16(bx + 0x12B6) * 2 + stride);
    if (frame === 0xFFFE || frame === 0xFFFF) return;
    const extra = this.src.extra;
    if (!extra) return;
    let x = d.rs16(bx + 0x125C), y = d.rs16(bx + 0x1268);
    if (round === 9) {
      const f = frame > 4 ? frame - 5 : frame;
      x -= d.rs16(0x264A); if (x <= -4) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -4) y += 0xC00;
      const c = this.clip(s16(x - 0x14), s16(y - 0x14), 0x28, 0x28);
      if (c) this.blitSprite(f * 0x640 + c.srcOff, c.di, c.w, c.h, c.skip, 'plain', 0, extra);
    } else {
      x -= d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
      const c = this.clip(s16(x - 0xC), s16(y - 0xC), 0x18, 0x18);
      if (c) this.blitSprite(frame * 0x240 + c.srcOff, c.di, c.w, c.h, c.skip, 'recolour', d.r16(bx + 0x1252) & 0xFF, extra);
    }
  }

  /** fn 7f62 / 7efa drawing (states 4 and 5): the car while the knockback runs ([12c2]), then the 24x24 animation
   *  frame from the extra bank picked by the table at `table` + [12b6]*2 (frame word at +0x12), as fn 7fe8. */
  private tableAnim(bx: number, round: number, table: number): void {
    const d = this.src.ds;
    if (d.r16(bx + 0x12C2) !== 0) return this.car(bx, round);
    const frame = d.r16(table + d.r16(bx + 0x12B6) * 2 + 0x12);
    if (frame === 0xFFFE || frame === 0xFFFF || !this.src.extra) return;
    let x = d.rs16(bx + 0x125C) - d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
    let y = d.rs16(bx + 0x1268) - d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
    const c = this.clip(s16(x - 0xC), s16(y - 0xC), 0x18, 0x18);
    if (c) this.blitSprite(frame * 0x240 + c.srcOff, c.di, c.w, c.h, c.skip, 'recolour', d.r16(bx + 0x1252) & 0xFF, this.src.extra);
  }

  /** fn 82be drawing (states 2 and 0x0D): the car during part of the sequence, then the 24x24 respawn frame from
   *  BITSFILE.PH0 (ds:45e3 + frame*0x240, fn 8339) at the respawn point ([12ba],[12bc]) minus the height. */
  private respawnAnim(bx: number): void {
    const d = this.src.ds;
    const st = d.r16(bx + 0x12AE), step = d.rs16(bx + 0x12B8);
    const frame = d.r16(0x289D + step * 2 + 0x0E);
    const round = d.r8(0x28BF);
    if (frame === 0xFFFE) return;
    if (frame === 0xFFFF) { if (st !== 0x0D) this.car(bx, round); return; }   // sequence over: back to state 0 and drawn
    if (st !== 2) { if (step <= 3) this.car(bx, round); }
    else if (step >= 3) this.car(bx, round);
    const dz = d.rs16(bx + 0x12D6);
    let x = d.rs16(bx + 0x12BA) - dz, y = d.rs16(bx + 0x12BC) - dz;
    x -= d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
    y -= d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
    const c = this.clip(s16(x - 0xC), s16(y - 0xC), 0x18, 0x18);
    if (c) this.blitFromDs(0x45E3 + frame * 0x240 + c.srcOff, c.di, c.w, c.h, c.skip);
  }

  /** fn 8386 drawing part -> fn 847e: 32x32 skid image (age << 10) + ds:5ee3, centred, plain blit. */
  private skidMarks(bx: number): void {
    const d = this.src.ds;
    if (d.rs16(bx + 0x1298) <= 0) return;
    for (let dx = 0; dx < 0x1E; dx += 6) {
      const p = bx + dx;
      const age = d.r16(p + 0x1361);
      if (age === 0xFFFF) continue;
      let x = s16(d.r16(p + 0x135D) - d.r16(0x264A)); if (x <= -0x20) x += 0xC00;
      let y = s16(d.r16(p + 0x135F) - d.r16(0x264C)); if (y <= -0x20) y += 0xC00;
      const c = this.clip(x - 0xC, y - 0xC, 0x20, 0x20);
      if (!c) continue;
      this.blitFromDs(0x5EE3 + (age << 10) + c.srcOff, c.di, c.w, c.h, c.skip);
    }
  }

  /** fn 8083 drawing part -> fn 8cd0/8ce4: two 8x8 foam/tyre bits per entry, image = base + age*64. */
  private tyreTracks(bx: number): void {
    const d = this.src.ds;
    if (d.rs16(bx + 0x1296) <= 0) return;
    for (let dx = 0; dx < 0x60; dx += 12) {
      const p = bx + dx;
      const age = d.r16(p + 0x1305);
      if (age === 0xFFFF) continue;
      const img = d.r16(p + 0x1307) + (age << 6);
      for (const [ox, oy] of [[0x12FD, 0x12FF], [0x1301, 0x1303]] as const) {
        let x = s16(d.r16(p + ox) - d.r16(0x264A)); if (x <= -8) x += 0xC00;
        let y = s16(d.r16(p + oy) - d.r16(0x264C)); if (y <= -8) y += 0xC00;
        x -= 4; y -= 4;                                        // fn 8cd0
        if (x < -0x17 || x > this.vp.width || y < -0x17 || y > this.vp.height) continue;   // fn 8ce4 (no clipping, just a bounds test)
        const di = (this.at(x, y) - this.fineX) & this.mask;
        this.blitFromDs(img, di, 8, 8, 0);
      }
    }
  }

  /** fn 8cd0 / 8ce4: 8x8 colour-0-transparent bit at world (x, y) minus camera, centred (-4); fn 8d36 / 8d4a draw the
   *  same shape as a colour-0 shadow. Bounds test only against the view, no clipping. */
  private bit8(img: number, wx: number, wy: number, shadow = false): void {
    const d = this.src.ds;
    let x = s16(wx - d.r16(0x264A)); if (x <= -8) x += 0xC00;
    let y = s16(wy - d.r16(0x264C)); if (y <= -8) y += 0xC00;
    x -= 4; y -= 4;
    if (x < -0x17 || x > this.vp.width || y < -0x17 || y > this.vp.height) return;
    let di = (this.at(x, y) - this.fineX) & this.mask;
    const m = this.src.ds.m;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) { const px = m[(img + r * 8 + c) & 0xFFFF /* ds */]!; if (px !== 0) this.back[(di + c) & this.mask] = shadow ? 0 : px; }
      di = (di + this.stride) & this.mask;
    }
  }

  /** fn 8712 drawing half: while [13a4] > 0x28 the particle image ([1396] >> 2, ds:72e3) flies with a shadow offset by
   *  ([139a],[139e]); for 0x1e <= [13a4] <= 0x28 the splash sequence 0..5..0 (ds:41e3) plays at the landing point. */
  private particle(bx: number): void {
    const d = this.src.ds;
    if (d.r16(bx + 0x1394) === 0) return;
    const life = d.r16(bx + 0x13A4);
    const px = d.r16(bx + 0x1398), py = d.r16(bx + 0x139C);
    if (life > 0x28) {
      const img = 0x72E3 + ((d.r16(bx + 0x1396) >> 2) << 6);
      this.bit8(img, px + d.r16(bx + 0x139A), py + d.r16(bx + 0x139E), true);
      this.bit8(img, px, py);
    } else if (life >= 0x1E) {
      const seq = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0];
      this.bit8(0x41E3 + (seq[life - 0x1E]! << 6), px, py);
    }
  }

  // ---------------------------------------------------------------- banners (fn 9289)
  /** Round 9 banners for states 0x0F / 0x10 (ds:8ce3 "time up", ds:9523 "finished"): 88x22 at ([26be] - 0x2c,
   *  [26c0] - 0xc), drawn plain or, while [26cf] == 1, as a colour-0 silhouette (blink). */
  private banners(): void {
    const d = this.src.ds;
    for (const bx of CARS) {
      const st = d.r16(bx + 0x12AE);
      if (st !== 0x0F && st !== 0x10) continue;
      if (d.r16(bx + 0x124C) === 0) continue;
      this.banner(st === 0x0F ? 0x8CE3 : 0x9523, d.rs16(0x26BE), d.rs16(0x26C0));
    }
    const h2h = this.race?.banner;                      // 9241..927e: BONUS / WINNER / PLAY OFF
    if (h2h) this.banner(h2h.src, h2h.x, h2h.y);
  }

  /** fn 35f0 at 3760: the Paused! banner (PH0 sprite 0x9d63) over the frame that is already on screen. */
  pauseFrame(): Uint8Array {
    this.src.ds.w8(0x26CF, 0);
    this.banner(0x9D63, this.vp.halfW, 0x3C);
    return this.copyToVram();
  }

  private banner(src: number, x: number, y: number): void {
    const d = this.src.ds;
    const rows = src === 0x9D63 ? 0x15 : 0x16;
    const c = this.clip(x - 0x2C, y - 0xC, 0x58, rows);
    if (!c) return;
    if (d.r8(0x26CF) === 1) this.blitSprite(src + c.srcOff, c.di, c.w, c.h, c.skip, 'shadow', 0, d.m);
    else this.blitFromDs(src + c.srcOff, c.di, c.w, c.h, c.skip);
  }

  // ---------------------------------------------------------------- HUD (drawing half of fn 8dfc)
  /** Lap counter and ranking panel. Runs after Race.fn8dfcRanking has sorted [2678..267e]; the HUD is pinned to the
   *  screen, so every destination is corrected by the fine x residue (fn 8d09 / 8dc0 subtract cs:[8994]). */
  private hud(): void {
    const d = this.src.ds;
    if (d.r8(0x28BF) === 9) {                            // round 9: elapsed time [26c8] >> 4, three digits (8ff5)
      let v = d.r16(0x26C8) >> 4;
      const lo = v % 10; v = Math.floor(v / 10);
      this.digit(lo, this.at(32, 8));
      if (lo !== 0) this.digit(10, this.at(24, 8));                 // 900b tests cx after fn 905f shifted it left by 7: any non-zero digit
      this.digit(v % 10, this.at(16, 8)); v = Math.floor(v / 10);
      this.digit(v % 10, this.at(8, 8));
      return;
    }
    if (d.r16(0x2656) === 2) {                           // head to head: leader lap digit + 8-segment tug bar
      const bx = d.r16(0x2678);
      this.digit(d.r16(bx + 0x12ED), this.at(8, 0));
      const score = d.rs16(0x26B4);
      for (let i = 8; i >= 1; i--) this.blitHud(i > score ? 0x5AE3 : 0x59E3, this.at(0, 16 + (8 - i) * 16), 16, 16);
      return;
    }
    this.digit(d.r16(d.r16(0x2660) + 0x12ED), this.at(8, 0));   // player's laps to go
    for (let i = 0; i < 4; i++) {
      this.carIcon(d.r16(0x2678 + i * 2), this.at(0, 16 + i * 16));
      this.digit(i + 1, this.at(16, 16 + i * 16));
    }
  }

  /** fn 905f: 8x16 digit n from ds:5463 (128 bytes each). */
  private digit(n: number, di: number): void { this.blitHud(0x5463 + ((n << 7) & 0xFFFF /* ds */), di, 8, 16); }

  /** fn 903f -> 8dc0: 16x16 car icon (ds:5363, or ds:5be3 once the car has finished) recoloured by [1252]. */
  private carIcon(bx: number, di: number): void {
    const m = this.src.ds.m;
    const src = this.src.ds.r16(bx + 0x12ED) !== 0 ? 0x5363 : 0x5BE3, add = this.src.ds.r8(bx + 0x1252);
    di = (di - this.fineX) & this.mask;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let px = m[src + y * 16 + x]!;
      if (px === 0) continue;
      const nib = px & 0xF;
      if (nib === 1 || nib === 2) px = (px + add) & 0xFF;
      this.back[(di + y * this.stride + x) & this.mask] = px;
    }
  }

  /** fn 8d09: screen-pinned colour-0-transparent blit from the data segment. */
  private blitHud(src: number, di: number, w: number, h: number): void { this.blitFromDs(src, (di - this.fineX) & this.mask, w, h, 0); }

  /** Plain colour-0-transparent blit from the data segment (fn 8ca4 / 8d0a). */
  private blitFromDs(src: number, di: number, w: number, h: number, skip: number): void {
    const m = this.src.ds.m;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = m[(src++) & 0xFFFF /* ds */]!;
        if (px !== 0) this.back[(di + x) & this.mask] = px;
      }
      src += skip;
      di = (di + this.stride) & this.mask;
    }
  }

  /** fn 8bab: clip a w x h sprite at screen (x, y) inside the 256 x 224 buffer window. */
  private clip(x: number, y: number, w: number, h: number): { di: number; skip: number; w: number; h: number; srcOff: number } | undefined {
    let srcOff = 0, skip = 0;
    if (x < 0) {
      w += x; if (w <= 0) return undefined;
      srcOff -= x; skip = -x; x = 0;
    } else {
      if (x >= this.vp.width) return undefined;
      if (x + w > this.vp.width) { const over = x + w - this.vp.width; w -= over; skip = over; }
    }
    let di: number;
    if (y < 0) {
      h += y; if (h <= 0) return undefined;
      srcOff += (-y) * (w + skip);
      di = this.origin + x;
    } else {
      if (y >= this.vp.clipH) return undefined;
      if (y + h > this.vp.clipH) { h = this.vp.clipH - y; di = this.vp.overflowDi + x; }   // quirk: below the visible rows
      else di = this.at(x, y);
    }
    di = (di - this.fineX) & this.mask;
    return { di, skip, w, h, srcOff };
  }

  private car(bx: number, round: number, at?: { x: number; y: number; dz: number }): void {
    const d = this.src.ds;
    if (d.r16(0x2621) === bx) return;
    const dz = at ? at.dz : round === 8 ? 0 : d.rs16(bx + 0x12D6);
    let x = s16(at ? at.x : d.r16(bx + 0x125C)) - dz, y = s16(at ? at.y : d.r16(bx + 0x1268)) - dz;
    const heading = d.r16(bx + 0x1278) & 0xF8;
    let size: number, frame: number;
    if (round === 9) {
      if (bx !== 0) return;
      frame = heading * 200; size = 0x28;
      x -= d.rs16(0x264A); if (x <= -4) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -4) y += 0xC00;
      x -= 0x14; y -= 0x14;
    } else {
      frame = heading * 72; size = 0x18;
      x -= d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
      x -= 0xC; y -= 0xC;
    }
    const c = this.clip(s16(x), s16(y), size, size);
    if (!c) return;
    const colour = round === 9 ? 0 : d.r16(bx + 0x1252) & 0xFF;
    this.blitSprite(frame + c.srcOff, c.di, c.w, c.h, c.skip, round === 9 ? 'plain' : 'recolour', colour);
    if (round === 8) {                                        // 7e3a: helicopter rotor over the drawn sprite
      const st = d.r16(bx + 0x12AE);
      if (st !== 0x0D && st !== 2) this.rotor(bx);
    }
  }

  /** fn 843d: 32x32 rotor frame (([1392] >> 1) & 3, images at ds:5ee3 + n*0x400 copied from the VH0 file in round 8)
   *  centred 4 px up-left of the helicopter, plain blit. The counter itself advances in Race.fn7d73Visibility. */
  private rotor(bx: number): void {
    const d = this.src.ds;
    let x = d.rs16(bx + 0x125C) - d.rs16(0x264A) - 4; if (x <= -0xC) x += 0xC00;
    let y = d.rs16(bx + 0x1268) - d.rs16(0x264C) - 4; if (y <= -0xC) y += 0xC00;
    const c = this.clip(s16(x - 0xC), s16(y - 0xC), 0x20, 0x20);
    if (c) this.blitFromDs(0x5EE3 + (((d.r16(bx + 0x1392) >> 1) & 3) << 10) + c.srcOff, c.di, c.w, c.h, c.skip);
  }

  private shadow(bx: number, round: number): void {
    const d = this.src.ds;
    if (round === 8) return;
    const dz = d.rs16(bx + 0x12D6);
    let x = d.rs16(bx + 0x125C) + dz, y = d.rs16(bx + 0x1268) + dz;
    const heading = d.r16(bx + 0x1278) & 0xF8;
    let size: number, frame: number;
    if (round === 9) {
      if (bx !== 0) return;
      frame = heading * 200; size = 0x28;
      x -= d.rs16(0x264A); if (x <= -4) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -4) y += 0xC00;
      x -= 0x14; y -= 0x14;
    } else {
      frame = heading * 72; size = 0x18;
      x -= d.rs16(0x264A); if (x <= -0xC) x += 0xC00;
      y -= d.rs16(0x264C); if (y <= -0xC) y += 0xC00;
      x -= 0xC; y -= 0xC;
    }
    const c = this.clip(s16(x), s16(y), size, size);
    if (!c) return;
    this.blitSprite(frame + c.srcOff, c.di, c.w, c.h, c.skip, 'shadow', 0);
  }

  /** fn 8c6a (recolour: pixels with low nibble <= 2 get +colour), fn 8ca4 (plain), fn 8c3c (shadow: colour 0). */
  private blitSprite(src: number, di: number, w: number, h: number, skip: number, mode: 'recolour' | 'plain' | 'shadow', colour: number,
    v: Uint8Array = this.src.vehicle): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let px = v[src]!; src++;
        if (px !== 0) {
          if (mode === 'shadow') px = 0;
          else if (mode === 'recolour' && (px & 0xF) <= 2) px = (px + colour) & 0xFF;
          this.back[(di + x) & this.mask] = px;
        }
      }
      src += skip;
      di = (di + this.stride) & this.mask;
    }
  }

  // ---------------------------------------------------------------- fn 92bc
  private copyToVram(): Uint8Array {
    const { outWidth, outX, width, height } = this.vp;
    const out = new Uint8Array(outWidth * height);
    let si = (this.origin - this.fineX) & this.mask;
    for (let row = 0; row < height; row++) {
      for (let x = 0; x < width; x++) out[row * outWidth + outX + x] = this.back[(si + x) & this.mask]!;
      si = (si + this.stride) & this.mask;
    }
    return out;
  }
}
