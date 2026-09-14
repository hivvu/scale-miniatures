/**
 * Front-end graphics engine: everything the game draws outside a race (options, title, menus, character
 * select, pre-race and results screens). Transliteration of MICRO_U.EXE fn 0400-0999 plus the loader fn 26c0.
 *
 * The front end owns a second, completely separate renderer from the race: a 0x110-byte-per-row buffer in
 * segment 6D78 whose visible area is only **256x200** pixels starting at offset 0x888, presented to VRAM at
 * x = 32 (fn 08bc). Images come from COMPRESS.PI0..6, decoded end to end into segment 1B78 (0xC000 bytes per
 * part); the headers in the data segment address them by absolute segment, and the sprite background-save
 * buffers live in the unused space after the last image, so the whole thing is modelled as one flat arena.
 *
 * Object records are 0x1B bytes in the data segment (0x0B7C..0x0D62, one per drawable):
 *   +00 image header pointer   +02 x (signed)        +04 y (signed)     +06 save-buffer segment
 *   +08 source segment         +0A mirror flag       +0B frame size     +0D source offset (clip output)
 *   +0F height                 +11 width             +13 frame index    +15 destination offset (FFFF = clipped)
 *   +17 source row padding     +19 rows to draw      +1A columns to draw
 * Image headers are 0x14 bytes: name (13, NUL-terminated), +0D height, +0F width, +11 frame count, +12 segment.
 */
import { DataSegment } from './memory';
import type { SoundPort } from './sound/port';
import type { AnalogueDevices } from './race';
export type { SoundPort };
import { lzDecode, loaderCopyLength } from '../data/lzcodec';

export const PI_SEG = 0x1B78;          // first COMPRESS.PI bank (fn 26c0 passes dx = 1B78)
export const PI_PART_PARAS = 0xC00;    // each part is 0xC000 bytes further on
export const BUF_SEG = 0x6D78;         // front-end back buffer
export const BUF_STRIDE = 0x110;       // 272 bytes per row
export const BUF_ORIGIN = 0x888;       // top-left visible pixel (row 8, column 8 of the buffer)
export const SCREEN_W = 256;           // the front end only ever uses 256x200 of the 320x200 mode
export const SCREEN_H = 200;
export const VRAM_ORIGIN = 0x20;       // presented at x = 32 (fn 08bc)

export const FIRST_RECORD = 0x0B7C;
export const RECORD_STRIDE = 0x1B;
export const LAST_RECORD = 0x0D62;     // exclusive, as in the fn 26c0 loop
export const FONT1 = 0x0B40;           // 8x8 header
export const FONT2 = 0x0B54;           // 8x16 header

/** Arena covering the segments the front end touches (banks at 1B78, save buffers, back buffer at 6D78). */
export function newArena(): Uint8Array { return new Uint8Array((BUF_SEG + 0x1000) * 16); }

/** Template name whose last digit fn 3547 advances per part ("COMPRESS.PI0" at ds:09F0). */
export const PI_TEMPLATE = 0x09F0;

/** fn 26c0 -> 3547: decode COMPRESS.PI0.. into consecutive banks from 1B78. Missing parts simply stop the loop,
 *  leaving the template digit at the first part that failed to open. */
export function loadFrontEndBanks(mem: Uint8Array, parts: (Uint8Array | undefined)[], ds?: DataSegment): number {
  let n = 0;
  for (const part of parts) {
    if (!part) break;
    const out = lzDecode(part);
    const len = loaderCopyLength(out.length);
    mem.set(out.data.subarray(0, len), (PI_SEG + n * PI_PART_PARAS) * 16);
    n++;
  }
  if (ds) {
    let e = PI_TEMPLATE;
    while (ds.r8(e) !== 0) e++;
    ds.w8(e - 1, 0x30 + n);
  }
  return n;
}

export interface ImageHeader { name: string; height: number; width: number; frames: number; seg: number; }

export function readImageHeader(ds: DataSegment, at: number): ImageHeader {
  let name = '';
  for (let i = 0; i < 13 && ds.r8(at + i) !== 0; i++) name += String.fromCharCode(ds.r8(at + i));
  return { name, height: ds.r16(at + 0x0D), width: ds.r16(at + 0x0F), frames: ds.r8(at + 0x11), seg: ds.r16(at + 0x12) };
}

export class FrontEnd {
  /** 320x200 output, written by present(); the front end only touches the 256 columns from x = 32. */
  readonly vram = new Uint8Array(64000);

  /** Set by the page when there is a sound device; the screens call it where the original called ah=4/5/6/7. */
  sound?: SoundPort;

  /** fn 321c: GAME OPTIONS calls this with the new [0f64] when F3 changes it, so the page can open or close
   *  the driver. */
  soundDevice?: (device: number) => void;

  /** The values of [0f64] the page can actually play. The original always offers all three (NONE, BLASTER,
   *  SPEAKER); set this to leave out a driver the port has not got, and F3 steps straight past it. */
  soundDevices?: readonly number[];

  /** True while GAME OPTIONS is up: that screen reads raw scancodes, so the page must not remap any key. */
  rawKeys = false;

  /** Set by the page when there is a joystick or a mouse: the calibration screen (F7) reads them directly. */
  devices?: AnalogueDevices;

  /** fn 3ad0: how many bursts of a thousand word writes to VRAM fit in one visible field, which is how AUTO
   *  picks the smoothness. The page owns the clock, so it owns the loop; without one the machine counts as
   *  the fastest class. */
  speed?: () => number;

  /** fn 2a13: leaving GAME OPTIONS writes the 32 bytes of SETTINGS.DAT back. The page decides where. */
  saveSettings?: (bytes: Uint8Array) => void;

  /**
   * Port only, and the one thing on GAME OPTIONS the original has not got: how much of the track the race
   * draws. `label` is what the screen shows beside it and `next` steps to the following size, the way F1 to
   * F4 step through theirs. Left undefined the screen is the original's to the pixel, which is what the
   * capture tests hold it to.
   */
  viewSize?: { label: string; next(): void };

  /** fn 2be8: the GAME?.LVL sets on the disk, in the order findfirst/findnext returned them. */
  gameSets?: readonly { digit: number; data: Uint8Array }[];

  constructor(readonly ds: DataSegment, readonly mem: Uint8Array) {}

  /** fn 0220/0100 and friends: start a song unless it is the one already playing. */
  song(n: number): void { if (!this.sound?.songPlaying(n)) this.sound?.setSong(n); }

  private get buf(): number { return BUF_SEG * 16; }

  // ---------------------------------------------------------------- records (fn 049c)
  /** fn 049c: copy the image header's geometry into an object record. */
  bindRecord(bx: number): void {
    const d = this.ds;
    const si = d.r16(bx);
    const h = d.r16(si + 0x0D), w = d.r16(si + 0x0F);
    d.w16(bx + 0x08, d.r16(si + 0x12));
    d.w16(bx + 0x0F, h);
    d.w16(bx + 0x11, w);
    d.w16(bx + 0x0B, (h * w) & 0xFFFF);
  }

  /** fn 26c0 tail: rebind every record after (re)loading the banks. */
  bindAllRecords(): void {
    for (let bx = FIRST_RECORD; bx < LAST_RECORD; bx += RECORD_STRIDE) this.bindRecord(bx);
  }

  // ---------------------------------------------------------------- clipping (fn 0630)
  /** fn 0630: clip a record to the 256x200 window and compute its source/destination offsets.
   *  Returns false (carry set) when it is entirely off-screen, leaving +15 = FFFF. */
  clip(bx: number): boolean {
    const d = this.ds;
    let di = d.rs16(bx + 0x02);                                   // x
    let si = (d.r16(bx + 0x13) * d.r16(bx + 0x0B)) & 0xFFFF;      // frame * frame size
    let dx = 0;
    let cx = d.r16(bx + 0x11);                                    // width
    const clipped = (): boolean => { d.w16(bx + 0x15, 0xFFFF); return false; };
    if (di < 0) {
      cx += di;
      if (cx <= 0) return clipped();
      si = (si - di) & 0xFFFF;
      dx = (dx - di) & 0xFFFF;
      di = 0;
    } else {
      if (di >= 0x100) return clipped();
      if (di + cx > 0x100) { const over = di + cx - 0x100; cx -= over; dx = (dx + over) & 0xFFFF; }
    }
    d.w8(bx + 0x1A, cx);                                          // columns (byte: a 256-wide image would store 0)
    d.w16(bx + 0x17, dx);
    let ax = d.r16(bx + 0x0F);                                    // height
    const y = d.rs16(bx + 0x04);
    if (y < 0) {
      ax += y;
      if (ax <= 0) return clipped();
      // literal: the original multiplies the visible height by the height again instead of the width
      si = (si + ((ax * d.r16(bx + 0x0F)) & 0xFFFF)) & 0xFFFF;
    } else {
      if (y >= 0xC8) return clipped();
      if (y + ax > 0xC8) ax = 0xC8 - y;
      di = (di + y * BUF_STRIDE) & 0xFFFF;
    }
    d.w16(bx + 0x0D, si);
    di = (di + BUF_ORIGIN) & 0xFFFF;
    d.w16(bx + 0x15, di);
    d.w8(bx + 0x19, ax);                                          // rows (byte)
    return true;
  }

  // ---------------------------------------------------------------- blits (fn 04b8/04bd/053a)
  /** Shared inner loop. `skipZero` = transparent (fn 04bd), otherwise opaque (fn 053a). */
  private rows(bx: number, skipZero: boolean, mirrorStartsWithPad: boolean): void {
    const d = this.ds, m = this.mem;
    const cl = d.r8(bx + 0x1A), rows = d.r8(bx + 0x19);
    const src = d.r16(bx + 0x08) * 16, dst = this.buf;
    const extra = d.r16(bx + 0x17);
    const mirror = d.r8(bx + 0x0A) === 1;
    let di = d.r16(bx + 0x15);
    let si = d.r16(bx + 0x0D);
    if (mirror) si = (si + cl + (mirrorStartsWithPad ? extra : 0)) & 0xFFFF;
    for (let r = 0; r < rows; r++) {
      if (!mirror) {
        for (let c = 0; c < cl; c++) {
          const v = m[src + ((si + c) & 0xFFFF)]!;
          if (!skipZero || v !== 0) m[dst + ((di + c) & 0xFFFF)] = v;
        }
        si = (si + cl + extra) & 0xFFFF;
      } else {
        for (let c = 0; c < cl; c++) {
          const v = m[src + ((si - 1 - c) & 0xFFFF)]!;
          if (!skipZero || v !== 0) m[dst + ((di + c) & 0xFFFF)] = v;
        }
        si = (si + cl + extra) & 0xFFFF;
      }
      di = (di + BUF_STRIDE) & 0xFFFF;
    }
  }

  /** fn 053a: clip and draw every pixel (no transparency, no background save). */
  blit(bx: number): void { if (this.clip(bx)) this.rows(bx, false, false); }

  /** fn 04bd: save the background, then draw skipping colour 0. Assumes the record is already clipped. */
  blitSpriteNoClip(bx: number): void { this.saveBackground(bx); this.rows(bx, true, true); }

  /** fn 04b8: clip, save the background and draw with colour 0 transparent. */
  blitSprite(bx: number): void { if (this.clip(bx)) this.blitSpriteNoClip(bx); }

  /** fn 05f3: copy the destination rectangle into the record's save buffer. */
  saveBackground(bx: number): void {
    const d = this.ds, m = this.mem;
    const si = d.r16(bx + 0x15);
    if (si === 0xFFFF) return;
    const seg = d.r16(bx + 0x06);
    if (seg === 0) return;
    const cl = d.r8(bx + 0x1A), rows = d.r8(bx + 0x19);
    const save = seg * 16, buf = this.buf;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cl; c++) m[save + ((r * cl + c) & 0xFFFF)] = m[buf + ((si + r * BUF_STRIDE + c) & 0xFFFF)]!;
    }
  }

  /** fn 05b4: put the saved background back and mark the record as not drawn. */
  restoreBackground(bx: number): void {
    const d = this.ds, m = this.mem;
    const di = d.r16(bx + 0x15);
    if (di === 0xFFFF) return;
    d.w16(bx + 0x15, 0xFFFF);
    const cl = d.r8(bx + 0x1A), rows = d.r8(bx + 0x19);
    const save = d.r16(bx + 0x06) * 16, buf = this.buf;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cl; c++) m[buf + ((di + r * BUF_STRIDE + c) & 0xFFFF)] = m[save + ((r * cl + c) & 0xFFFF)]!;
    }
  }

  /** fn 06cc: clip the record and draw a one-pixel border around it in colour `al`. */
  outline(bx: number, al: number): void {
    this.clip(bx);
    const d = this.ds, m = this.mem;
    let di = (d.r16(bx + 0x15) - 0x111) & 0xFFFF;
    const rows = d.r8(bx + 0x19), cl = d.r8(bx + 0x1A);
    const buf = this.buf;
    const put = (): void => { m[buf + (di & 0xFFFF)] = al; di = (di + 1) & 0xFFFF; };
    for (let i = 0; i < cl + 2; i++) put();
    const dx = (BUF_STRIDE - cl - 2) & 0xFFFF;
    di = (di + dx) & 0xFFFF;
    for (let r = 0; r < rows; r++) { put(); di = (di + cl) & 0xFFFF; put(); di = (di + dx) & 0xFFFF; }
    for (let i = 0; i < cl + 2; i++) put();
  }

  /** fn 0710: 8x8 tile map (CASE.MAP over CASE.CHR) written straight into the buffer at `di`. */
  tilemap(di0: number, tileHeader: number, mapHeader: number): void {
    const d = this.ds, m = this.mem;
    const tiles = d.r16(tileHeader + 0x12) * 16;
    const map = d.r16(mapHeader + 0x12) * 16;
    const cols = m[map]!, rows = m[map + 1]!;
    let src = 2;
    let rowStart = (di0 + BUF_ORIGIN) & 0xFFFF;
    for (let ty = 0; ty < rows; ty++) {
      let di = rowStart;
      for (let tx = 0; tx < cols; tx++) {
        const tile = m[map + src]! << 6;
        src++;
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) m[this.buf + ((di + r * BUF_STRIDE + c) & 0xFFFF)] = m[tiles + tile + r * 8 + c]!;
        }
        di = (di + 8) & 0xFFFF;
      }
      rowStart = (rowStart + 8 * BUF_STRIDE) & 0xFFFF;
    }
  }

  // ---------------------------------------------------------------- fills and presentation
  /** fn 0876: fill the whole 256x200 area with colour `al`. */
  clearScreen(al: number): void { this.fillRows(BUF_ORIGIN, 0xC8, al); }

  /** fn 0862: fill `cx` whole rows from row `bx` with colour `al`. */
  fillRowsAt(y: number, rows: number, al: number): void { this.fillRows((y * BUF_STRIDE + BUF_ORIGIN) & 0xFFFF, rows, al); }

  private fillRows(di0: number, rows: number, al: number): void {
    const m = this.mem, buf = this.buf;
    let di = di0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < SCREEN_W; c++) m[buf + ((di + c) & 0xFFFF)] = al;
      di = (di + BUF_STRIDE) & 0xFFFF;
    }
  }

  /** fn 0823: fill a `w` x `rows` rectangle at (x, y) with colour `si`. */
  fillRect(x: number, y: number, rows: number, w: number, colour: number): void {
    const m = this.mem, buf = this.buf;
    let di = (y * BUF_STRIDE + BUF_ORIGIN + x) & 0xFFFF;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < w; c++) m[buf + ((di + c) & 0xFFFF)] = colour & 0xFF;
      di = (di + BUF_STRIDE) & 0xFFFF;
    }
  }

  /** fn 07e5: replace colour `from` with `to` inside a `w` x `rows` rectangle at (x, y). */
  recolour(x: number, y: number, rows: number, w: number, to: number, from: number): void {
    const m = this.mem, buf = this.buf;
    let di = (y * BUF_STRIDE + BUF_ORIGIN + x) & 0xFFFF;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < w; c++) {
        const a = buf + ((di + c) & 0xFFFF);
        if (m[a] === from) m[a] = to;
      }
      di = (di + BUF_STRIDE) & 0xFFFF;
    }
  }

  /** fn 08bc: copy the whole visible area to VRAM. */
  present(): void { this.presentRows(0, 0xC8); }

  /** fn 089c: copy `rows` rows from row `y` to VRAM. */
  presentRows(y: number, rows: number): void {
    const m = this.mem, buf = this.buf;
    let si = (y * BUF_STRIDE + BUF_ORIGIN) & 0xFFFF;
    let di = y * 320 + VRAM_ORIGIN;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < SCREEN_W; c++) this.vram[di + c] = m[buf + ((si + c) & 0xFFFF)]!;
      si = (si + BUF_STRIDE) & 0xFFFF;
      di += 320;
    }
  }

  // ---------------------------------------------------------------- text (fn 08f0/0910/0929/0999)
  /** fn 08f0: draw string number `cx` of the NUL-separated list at `si`; x = FFFF centres it. */
  textFromList(si: number, index: number, x: number, y: number, font: number): void {
    const d = this.ds;
    let p = si;
    for (let n = index; n > 0; n--) { while (d.r8(p) !== 0) p++; p++; }
    if (x === 0xFFFF) this.textCentred(p, y, font); else this.textAt(p, x, y, font);
  }

  /** fn 0910: centre the string on the 256-pixel screen (x = 0x7F - 4 * length). */
  textCentred(si: number, y: number, font: number): void {
    const d = this.ds;
    let dx = 0x7F;
    for (let p = si; d.r8(p) !== 0; p++) dx -= 4;
    this.textAt(si, dx, y, font);
  }

  /** fn 0929: draw a NUL-terminated string at (x, y); a negative x scrolls it in from the left. */
  textAt(si: number, x: number, y: number, font: number): void {
    const d = this.ds;
    let di = (y * BUF_STRIDE + BUF_ORIGIN) & 0xFFFF;
    let p = si;
    let cx = 0;
    while (d.r8(p) !== 0) { p++; cx++; }
    cx++;                                                 // the count includes the terminator
    p = si;
    let ax = x & 0xFFFF;
    if (ax & 0x8000) {
      ax = (-(ax | 0) | 0) & 0xFFFF;                      // neg ax
      const whole = ax >> 3;
      ax &= 7;
      p += whole;
      cx -= whole;
      di = (di - ax) & 0xFFFF;
      ax = (-ax) & 0xFFFF;
    } else di = (di + ax) & 0xFFFF;
    const seg = d.r16(font + 0x12) * 16;
    const height = d.r8(font + 0x0D);
    let bx = ax & 0xFFFF;                                 // running x used by the right-edge guard
    if (cx <= 0) return;
    for (; cx > 0; cx--) {
      bx = (bx + 8) & 0xFFFF;
      if (bx >= 0x107) return;
      const ch = d.r8(p);
      p++;
      if (ch === 0) return;
      if (ch !== 0x20) this.glyph(ch, seg, height, di);
      di = (di + 8) & 0xFFFF;
    }
  }

  /**
   * The same glyphs for a line the original has not got. Only what fn 0999 knows draws: digits, capitals,
   * '!' and '?'; a space leaves a gap and anything else would come out as some other letter, so the port's
   * own text sticks to that alphabet.
   */
  textLiteral(s: string, x: number, y: number, font: number): void {
    const d = this.ds;
    const seg = d.r16(font + 0x12) * 16, height = d.r8(font + 0x0D);
    let di = (y * BUF_STRIDE + BUF_ORIGIN + x) & 0xFFFF;
    let bx = x;
    for (let i = 0; i < s.length; i++) {
      bx += 8;
      if (bx >= 0x107) return;                            // the right-edge guard of fn 0929
      const ch = s.charCodeAt(i);
      if (ch !== 0x20) this.glyph(ch, seg, height, di);
      di = (di + 8) & 0xFFFF;
    }
  }

  /** fn 0999: one glyph, colour 0 transparent. Digits, letters, '!' (36) and '?' (37). */
  private glyph(ch: number, seg: number, height: number, di0: number): void {
    const m = this.mem, buf = this.buf;
    let idx: number;
    if (ch === 0x21) idx = 0x24;
    else if (ch === 0x3F) idx = 0x25;
    else { idx = (ch - 0x30) & 0xFF; if (idx > 9) idx = (idx - 7) & 0xFF; }
    let si = (idx * ((height << 3) & 0xFF)) & 0xFFFF;
    let di = di0;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < 8; c++) {
        const v = m[seg + ((si + c) & 0xFFFF)]!;
        if (v !== 0) m[buf + ((di + c) & 0xFFFF)] = v;
      }
      si = (si + 8) & 0xFFFF;
      di = (di + BUF_STRIDE) & 0xFFFF;
    }
  }
}

/** Load segment DOS gives the game under DOSBox-X; only needed to compare against captures. */
export const LOAD_SEG = 0x0822;
