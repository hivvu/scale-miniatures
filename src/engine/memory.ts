/** Byte image of the game's data segment (DS = 093C) with the 16-bit access helpers the transliterated
 *  routines use. Keeping the original layout reproduces struct offsets, aliasing and wrap-around for free. */
export function s16(v: number): number { v &= 0xFFFF; return v & 0x8000 ? v - 0x10000 : v; }
export function s8(v: number): number { v &= 0xFF; return v & 0x80 ? v - 0x100 : v; }

/** `imul` 16x16 followed by `mov al,ah ; mov ah,dl ; shl ax,1`: (product >> 8) << 1, truncated to 16 bits. */
export function mulfix(a: number, b: number): number {
  const p = s16(a) * s16(b);                 // |p| < 2^31, exact in doubles
  return ((p >> 8) << 1) & 0xFFFF;
}

export class DataSegment {
  readonly m: Uint8Array;
  constructor(image?: Uint8Array) {
    this.m = new Uint8Array(0x10000);
    if (image) this.m.set(image.subarray(0, 0x10000));
  }
  r8(o: number): number { return this.m[o & 0xFFFF]!; }
  rs8(o: number): number { return s8(this.m[o & 0xFFFF]!); }
  r16(o: number): number { o &= 0xFFFF; return this.m[o]! | (this.m[(o + 1) & 0xFFFF]! << 8); }
  rs16(o: number): number { return s16(this.r16(o)); }
  w8(o: number, v: number): void { this.m[o & 0xFFFF] = v & 0xFF; }
  w16(o: number, v: number): void { o &= 0xFFFF; v &= 0xFFFF; this.m[o] = v & 0xFF; this.m[(o + 1) & 0xFFFF] = v >> 8; }
  add16(o: number, v: number): void { this.w16(o, this.r16(o) + v); }
}

export class NotImplementedYet extends Error {
  constructor(what: string) { super(`not transliterated yet: ${what}`); }
}
