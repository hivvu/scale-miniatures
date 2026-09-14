/**
 * The Codemasters intro: transliteration of SM.EXE, the little program MICRO.COM runs before MICRO.EXE.
 *
 * SM.EXE is a plain MZ with no relocations and cs = ds = the load segment, so every address below is an
 * offset into its load image (the file past the 512-byte header). It draws straight into mode 13h at A000,
 * one frame per vertical retrace, so `step()` here is one frame of the intro.
 *
 * See re/notes/52-intro.md.
 */

/** Offsets in the SM.EXE load image. */
const GFX_NAME = 0x0006, FONT_NAME = 0x0010;      // "gfx1.gfx", "antifont.bin"
const LETTERS = 0x001E;                            // 48 entries of 14 bytes: the Codemasters letters
const LETTERS_END = 0x0292;
const GLYPH = 0x02C6;                              // object record used for one antifont glyph
const LETTER = 0x02D6;                             // ... for one letter of the logo
const ABSOLUTELY = 0x02E6, BRILLIANT = 0x02F6;     // ... for the two sliding words
const SLIDE_END = 0x02C0;                          // x both words stop at (0x48)
const LETTER_INDEX = 0x02BE;
const KEY_A = 0x02C4, KEY_B = 0x02C5;
const ISR_SCANCODE = 0x0362;
const STRIDE = 0x0366;                             // 0x140
const MODE_PALETTE = 0x036C;                       // 768 bytes set with int 10 ax=1012
const COPYRIGHT = 0x06A2;                          // "(c) Codemasters 1994."
const STAMP = 0x0680;                              // "T:v .   A:v .   D:  /  /     :  ", patched from 066c..
const STAMP_SRC = 0x066C;
const EXIT = 0x06B8, HOLD = 0x06BA, NO_VGA = 0x06BC, NO_MOUSE = 0x06BE;
const STAMP_X = 0x06BF, STAMP_Y = 0x06C1;
const SLID = 0x06C3, STAMP_DRAWN = 0x06C5;
const SHINE_X = 0x06C7, SHINE_Y = 0x06C9, SHINE_WARM = 0x06CB, SHINE_DONE = 0x06CD;
const WIDTHS = 0x06CF;                             // char/width pairs, ending with width 0xff
const GLYPH_BYTES = 0x8F;                          // 11 x 13 per glyph in ANTIFONT.BIN

/** Scratch past the end of the 4320-byte load image, for a line the original does not have. */
const PORT_LINE = 0x2000;

const SCREEN_W = 320, SCREEN_H = 200;

/** The two allocations SM.EXE makes with int 21 ah=48 (fn 0bef / 0c0e load one file into each). */
const enum Bank { Gfx = 1, Font = 2 }

export class Intro {
  /** Mode 13h screen, exactly what SM.EXE writes to A000. */
  readonly vram = new Uint8Array(SCREEN_W * SCREEN_H);
  /** The palette SM.EXE sets with int 10 ax=1012, as the DAC keeps it: 768 bytes of six bits each. */
  readonly palette: Uint8Array;
  /** Frames run so far; the original leaves after the shine plus 0xfa more (fn 0aac). */
  frame = 0;

  private readonly m: Uint8Array;                  // the SM.EXE load image, used as its data segment
  private readonly gfx: Uint8Array;
  private readonly font: Uint8Array;
  /** True when a port credit was supplied: the copyright line then moves up to make room for it. */
  private portLine = false;

  /**
   * `portLine`, if given, is drawn under the Codemasters copyright, which moves up to make room. It is off
   * by default: with it on, the intro no longer matches the DOSBox captures frame for frame.
   */
  constructor(smExe: Uint8Array, gfx1: Uint8Array, antifont: Uint8Array, portLine?: string) {
    const headerParas = smExe[8]! | (smExe[9]! << 8);
    const image = smExe.subarray(headerParas * 16);
    this.m = new Uint8Array(0x4000);               // the image, plus room for PORT_LINE past its end
    this.m.set(image.subarray(0, Math.min(image.length, 0x4000)));
    this.gfx = gfx1;
    this.font = antifont;
    if (this.name(GFX_NAME) !== 'gfx1.gfx' || this.name(FONT_NAME) !== 'antifont.bin') {
      throw new Error('not SM.EXE: the two file names are not where they should be');
    }
    if (portLine !== undefined) {
      for (let i = 0; i < portLine.length; i++) this.w8(PORT_LINE + i, portLine.charCodeAt(i) & 0xFF);
      this.w8(PORT_LINE + portLine.length, 0);
      this.portLine = true;
    }
    // a few entries in the file are 0xff / 0xfc; the VGA DAC only latches six bits, so it sees 0x3f / 0x3c
    this.palette = this.m.subarray(MODE_PALETTE, MODE_PALETTE + 0x300).map(v => v & 0x3F);
    this.w16(LETTER + 0x08, Bank.Gfx);             // fn 0bef / 0c0e: the segment each record reads from
    this.w16(ABSOLUTELY + 0x08, Bank.Gfx);
    this.w16(BRILLIANT + 0x08, Bank.Gfx);
    this.w16(GLYPH + 0x08, Bank.Font);
    this.reset();
  }

  // ---------------------------------------------------------------- data segment helpers
  private r8(o: number): number { return this.m[o]!; }
  private w8(o: number, v: number): void { this.m[o] = v & 0xFF; }
  private r16(o: number): number { return this.m[o]! | (this.m[o + 1]! << 8); }
  private s16(o: number): number { const v = this.r16(o); return v >= 0x8000 ? v - 0x10000 : v; }
  private w16(o: number, v: number): void { this.m[o] = v & 0xFF; this.m[o + 1] = (v >> 8) & 0xFF; }
  /** Bounded, because it runs before the "not SM.EXE" check below and must not hang on a wrong file. */
  private name(o: number): string {
    let s = '';
    for (let p = o; p < this.m.length && this.m[p] !== 0 && s.length < 64; p++) s += String.fromCharCode(this.m[p]!);
    return s;
  }

  /** fn 07f1 + the tail of fn 0788: the state every run starts from. */
  private reset(): void {
    for (const o of [LETTER_INDEX, SLIDE_END, 0x02C2, EXIT, HOLD, STAMP_X, STAMP_Y, SLID,
      SHINE_X, SHINE_Y, SHINE_WARM, SHINE_DONE, STAMP_DRAWN]) this.w16(o, 0);
    this.w8(KEY_A, 0); this.w8(KEY_B, 0);
    this.w16(SLIDE_END, 0x48);
    this.w8(NO_MOUSE, 0);                          // fn 07da: a browser always has a pointer
    this.w16(NO_VGA, 0);
    this.vram.fill(0);                             // int 10 ax=0013 clears the screen
    this.copyright();                              // fn 0855
    this.buildStamp();                             // fn 08ef
    this.w16(SHINE_X, 0x48);
    this.w16(SHINE_Y, 0x50);
    this.frame = 0;
  }

  // ---------------------------------------------------------------- fn 0ccc: the only blit
  /** fn 0c24: clip x/width to the 320-pixel line; returns the source x offset, or undefined when invisible. */
  private static clip(x: number, w: number): { x: number; w: number; src: number } | undefined {
    if (x >= SCREEN_W) return undefined;           // 0c2a: off the right (x is unsigned here in the original)
    if (x >= 0) {
      const room = SCREEN_W - x;
      return { x, w: w < room ? w : room, src: 0 };
    }
    const visible = w + x;                         // 0c3f: x is negative, so the width shrinks
    if (visible <= 0) return undefined;
    return { x: 0, w: visible, src: -x };
  }

  /** fn 0ccc: copy a rectangle from one of the two banks into the screen. No transparency, whole words. */
  private blit(rec: number, bank: Bank): void {
    const x = this.s16(rec), y = this.r16(rec + 2), width = this.r16(rec + 4);
    const c = Intro.clip(x, width);
    if (!c) return;
    const rows = this.r16(rec + 6);
    const source = bank === Bank.Gfx ? this.gfx : this.font;
    let si = this.r16(rec + 0x0A) + c.src;
    let di = y * this.r16(STRIDE) + c.x;
    const words = c.w >> 1;                        // 0cfa: whole words, so an odd width loses its last column
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < words * 2; i++) this.vram[di + i] = source[si + i] ?? 0;
      di += SCREEN_W;
      si += width;
    }
  }

  // ---------------------------------------------------------------- text (fn 0855 / 08ef / 0af9)
  /** The width table at [06cf]; an unknown character has no entry and is skipped. */
  /** The table ends with a width of 0xff; the bound is there so a damaged ANTIFONT.BIN cannot spin. */
  private glyphOf(ch: number): { index: number; width: number } | undefined {
    let di = WIDTHS, index = 0;
    while (di + 1 < this.m.length) {
      if (this.r8(di) === ch) return { index, width: this.r8(di + 1) };
      di += 2; index++;
      if (this.r8(di + 1) === 0xFF) return undefined;
    }
    return undefined;
  }

  /** Total width of a NUL-terminated string in the proportional font. */
  private textWidth(at: number): number {
    let w = 0;
    for (let p = at; this.r8(p) !== 0; p++) w += this.glyphOf(this.r8(p))?.width ?? 0;
    return w;
  }

  /** fn 0855 / 0af9 body: draw a string with the antifont glyphs at (x, y). */
  private text(at: number, x: number, y: number): void {
    this.w16(GLYPH + 0x02, y);
    this.w16(GLYPH, x);
    for (let p = at; this.r8(p) !== 0; p++) {
      const g = this.glyphOf(this.r8(p));
      if (!g) continue;
      this.w16(GLYPH + 0x04, 0x0B);                // 08bc: 11 wide, so the blit copies only 10 columns
      this.w16(GLYPH + 0x0A, (GLYPH_BYTES * g.index) & 0xFFFF);
      this.blit(GLYPH, Bank.Font);
      this.w16(GLYPH, this.r16(GLYPH) + g.width);
    }
  }

  /**
   * fn 0855: "(c) Codemasters 1994." centred at y = 0xb4.
   *
   * Fitting a second line under it is tighter than it looks. fn 0ac6 clears rows 159..177 on the frames it
   * runs, and a glyph's ink is rows y+1..y+9, so the only space is 178..199: two lines exactly, at 178 and
   * 188. With the port credit on, Codemasters' line therefore moves up by two rows and the credit goes
   * underneath; their notice itself is left exactly as it is.
   */
  private copyright(): void {
    this.text(COPYRIGHT, (SCREEN_W - this.textWidth(COPYRIGHT)) >> 1, this.portLine ? 0xB2 : 0xB4);
    if (this.portLine) this.text(PORT_LINE, (SCREEN_W - this.textWidth(PORT_LINE)) >> 1, 0xBC);
  }

  /** fn 08ef: patch the build stamp with the bytes at [066c..] and work out where it would be centred. */
  private buildStamp(): void {
    const put = (at: number, from: number): void => {
      this.w8(STAMP + at, this.r8(from));
      this.w8(STAMP + at + 1, this.r8(from + 1));
    };
    this.w8(STAMP + 0x03, this.r8(STAMP_SRC)); this.w8(STAMP + 0x05, this.r8(STAMP_SRC + 1));
    this.w8(STAMP + 0x0B, this.r8(STAMP_SRC + 4)); this.w8(STAMP + 0x0D, this.r8(STAMP_SRC + 5));
    put(0x12, STAMP_SRC + 8); put(0x15, STAMP_SRC + 10); put(0x18, STAMP_SRC + 12);
    put(0x1B, STAMP_SRC + 14); put(0x1E, STAMP_SRC + 16);
    this.w16(STAMP_X, (SCREEN_W - this.textWidth(STAMP)) >> 1);
    this.w16(STAMP_Y, 0xA0);
  }

  // ---------------------------------------------------------------- one frame (fn 097f)
  /** One frame of the intro. False once it has asked to leave (fn 0aac's 0xfa-frame hold, or a click). */
  step(): boolean {
    this.fn0aac();
    this.fn0bb3();
    this.fn0b83();
    this.fn0ac6();
    if (this.r16(SLID) !== 0 && this.r16(SHINE_DONE) === 0) {
      this.shine(+0x10, this.r16(SHINE_X));        // fn 0a48, which also advances the sweep
      this.advanceShine();
      if (this.r16(SHINE_WARM) >= 6) this.shine(-0x10, this.r16(SHINE_X) - 0x20);   // fn 09f8
    }
    this.frame++;
    return this.r16(EXIT) === 0;
  }

  /** A mouse button (int 33 ax=3): the only way to cut the intro short. */
  click(): void { this.w16(EXIT, 0xFFFF); }

  /** int 9 (fn 0cbf): the intro only watches A and B, and only to show its build stamp. */
  key(scancode: number): void {
    this.w8(ISR_SCANCODE, scancode);
    this.fn09d0();
  }

  /** fn 0aac: once the sweep is over, hold the finished picture for 0xfa frames and leave. */
  private fn0aac(): void {
    if (this.r16(SHINE_DONE) === 0) return;
    this.w16(HOLD, this.r16(HOLD) + 1);
    if (this.r16(HOLD) === 0xFA) this.w16(EXIT, 0xFFFF);
  }

  /** fn 0bb3: one entry of the letter table per frame, then hold on the last one. */
  private fn0bb3(): void {
    const e = LETTERS + this.r16(LETTER_INDEX);
    this.w16(LETTER, this.r16(e) + this.r16(e + 2));
    this.w16(LETTER + 0x02, this.r16(e + 6));
    this.w16(LETTER + 0x0A, this.r16(e + 8));
    this.w16(LETTER + 0x04, this.r16(e + 0x0A));
    this.w16(LETTER + 0x06, this.r16(e + 0x0C));
    this.blit(LETTER, Bank.Gfx);
    if (this.r16(LETTER_INDEX) !== LETTERS_END) this.w16(LETTER_INDEX, this.r16(LETTER_INDEX) + 0x0E);
  }

  /** fn 0b83: ABSOLUTELY comes in from the left and BRILLIANT from the right, eight pixels a frame. */
  private fn0b83(): void {
    if (this.r16(SLID) !== 0) return;
    this.w16(ABSOLUTELY, this.r16(ABSOLUTELY) + 8);
    this.w16(BRILLIANT, this.r16(BRILLIANT) - 8);
    this.blit(ABSOLUTELY, Bank.Gfx);
    this.blit(BRILLIANT, Bank.Gfx);
    if (this.r16(ABSOLUTELY) === this.r16(SLIDE_END)) this.w16(SLID, 0xFF);
  }

  /** fn 0ac6: holding A and B together puts the build stamp up; letting go wipes it again. */
  private fn0ac6(): void {
    if (this.r8(KEY_A) + this.r8(KEY_B) !== 2) {
      this.w16(STAMP_DRAWN, 0);
      this.vram.fill(0, 0xC6C0, 0xC6C0 + 0xBE0 * 2);
      return;
    }
    this.w16(HOLD, 0);
    if (this.r16(STAMP_DRAWN) !== 0) return;
    this.text(STAMP, this.r16(STAMP_X), this.r16(STAMP_Y));
    this.w16(STAMP_DRAWN, 1);
  }

  /** fn 09d0: make and break of A (0x1e) and B (0x30). */
  private fn09d0(): void {
    const al = this.r8(ISR_SCANCODE);
    if (al === 0x9E) this.w8(KEY_A, 0);
    if (al === 0xB0) this.w8(KEY_B, 0);
    if (al === 0x1E) this.w8(KEY_A, 1);
    if (al === 0x30) this.w8(KEY_B, 1);
  }

  /** fn 0a48 / 09f8: a 70-step diagonal band, eight pixels a row, brightened or darkened by 0x10. */
  private shine(delta: number, x0: number): void {
    let x = x0, y = this.r16(SHINE_Y);
    for (let n = 0; n < 0x46; n++) {
      const row = y * SCREEN_W;
      for (let i = 0; i < 8; i++) {
        const at = (row + x + i) & 0xFFFF;         // the original just lets si wrap inside A000
        if (at < this.vram.length) this.vram[at] = (this.vram[at]! + delta) & 0xFF;
      }
      y++; x--;
    }
  }

  /** fn 0a48 tail: the sweep crosses the screen and then the intro is done. */
  private advanceShine(): void {
    if (this.r16(SHINE_WARM) !== 8) this.w16(SHINE_WARM, this.r16(SHINE_WARM) + 1);
    this.w16(SHINE_X, this.r16(SHINE_X) + 8);
    if (this.r16(SHINE_X) === 0x138) this.w16(SHINE_DONE, 0xFFFF);
  }
}
