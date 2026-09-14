/**
 * PKLITE 1.15 (extra compression, large model) depacker for MICRO.EXE, port of tools/mm/pklite.py, which was
 * transliterated from the stub inside the executable.
 *
 * Stub layout (image offsets, image = file minus the 0x60-byte MZ header):
 *   0x000 loader, 0x034 XOR-chain decryptor (0x136 words from 0x2B2 downwards, plain = c[i] ^ c[i+1], seed 0x070C),
 *   0x058 decompressor (prefix tables at decompressor-relative 0x21D / 0x228 / 0x233 / 0x243),
 *   0x2C0 compressed bitstream, then relocations, then SS SP CS IP.
 *
 * Bitstream: 16-bit LE words, LSB first. Flag 0 = literal (byte ^ remaining-bit counter), flag 1 = match.
 * Lengths come from a prefix tree with escape 0x19 (+ raw byte; 0xFE = no-op, 0xFF = end). Offsets: high byte from
 * a prefix tree, low byte raw. Relocations: [count][offset * count] blocks, count 0 advances the segment by 0x0FFF
 * paragraphs, 0xFFFF terminates.
 */

export interface UnpackedExe {
  /** Load image (segment 0 = load segment). */
  image: Uint8Array;
  relocs: { segment: number; offset: number }[];
  ss: number; sp: number; cs: number; ip: number;
}

const HEADER_LEN = 0x60, COMPRESSED_START = 0x2C0, DECRYPT_TOP = 0x2B2, DECRYPT_WORDS = 0x136, DECRYPT_SEED = 0x070C;
const DECOMP_BASE = 0x58;

class BitReader {
  private buf = 0;
  left = 0;
  constructor(private readonly data: Uint8Array, public pos: number) { this.reload(); }
  private reload(): void { this.buf = this.data[this.pos]! | (this.data[this.pos + 1]! << 8); this.pos += 2; this.left = 16; }
  bit(): number { const b = this.buf & 1; this.buf >>= 1; if (--this.left === 0) this.reload(); return b; }
  byte(): number { return this.data[this.pos++]!; }
  word(): number { const v = this.data[this.pos]! | (this.data[this.pos + 1]! << 8); this.pos += 2; return v; }
}

function decryptStub(image: Uint8Array): void {
  let prev = DECRYPT_SEED, off = DECRYPT_TOP;
  for (let i = 0; i < DECRYPT_WORDS; i++) {
    const w = image[off]! | (image[off + 1]! << 8), p = w ^ prev;
    image[off] = p & 0xFF; image[off + 1] = p >> 8;
    prev = w; off -= 2;
  }
}

/** Returns the match length, -1 for the 0xFE no-op, or undefined at the end marker. */
function readLength(br: BitReader, t1: Uint8Array, t2: Uint8Array, t3: Uint8Array): number | undefined {
  let bx = br.bit();
  bx = (bx << 1) | br.bit();
  if (bx >= 2) return bx;
  bx = (bx << 1) | br.bit();
  if (bx === 0) return t1[0]!;
  bx = (bx << 1) | br.bit();
  if (bx < 5) return t1[bx]!;
  bx = (bx << 1) | br.bit();
  if (bx <= 0xC) return t1[bx]!;
  bx &= 3;
  bx = (bx << 1) | br.bit();
  let cl: number;
  if (bx < 5) cl = t2[bx]!;
  else {
    bx = (bx << 1) | br.bit();
    if (bx <= 0xC) cl = t2[bx]!;
    else {
      bx &= 3;
      bx = (bx << 1) | br.bit();
      if (bx < 5) cl = t3[bx]!;
      else { bx = (bx << 1) | br.bit(); cl = t3[bx]!; }
    }
  }
  if (cl !== 0x19) return cl;
  const al = br.byte();
  if (al >= 0xFE) return al === 0xFF ? undefined : -1;
  return 0x19 + al;
}

function readOffsetHigh(br: BitReader, toff: Uint8Array): number {
  if (br.bit()) return 0;
  let bx = 0;
  for (let i = 0; i < 3; i++) bx = (bx << 1) | br.bit();
  if (bx < 2) return toff[bx]!;
  bx = (bx << 1) | br.bit();
  if (bx < 8) return toff[bx]!;
  bx = (bx << 1) | br.bit();
  if (bx < 0x17) return toff[bx]!;
  bx = (bx << 1) | br.bit();
  return bx & 0xDF;
}

export function isPkliteExe(data: Uint8Array): boolean {
  if (data.length < 0x60 || data[0] !== 0x4D || data[1] !== 0x5A) return false;
  const hdr = (data[8]! | (data[9]! << 8)) * 16;
  return hdr === HEADER_LEN && data[0x1C] === 0x0F && (data[0x1D]! & 0x30) === 0x30;
}

export function unpackPklite(data: Uint8Array): UnpackedExe {
  if (!isPkliteExe(data)) throw new Error('expected a PKLITE 1.15 executable (extra compression, large model)');
  const image = data.slice(HEADER_LEN);
  decryptStub(image);
  const t1 = image.subarray(DECOMP_BASE + 0x21D, DECOMP_BASE + 0x22D), t2 = image.subarray(DECOMP_BASE + 0x228, DECOMP_BASE + 0x238);
  const t3 = image.subarray(DECOMP_BASE + 0x233, DECOMP_BASE + 0x243), toff = image.subarray(DECOMP_BASE + 0x243, DECOMP_BASE + 0x263);

  let out = new Uint8Array(0x20000), n = 0;
  const push = (b: number): void => {
    if (n === out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; }
    out[n++] = b;
  };
  const br = new BitReader(image, COMPRESSED_START);
  for (;;) {
    if (br.bit() === 0) { push(br.byte() ^ (br.left & 0xFF)); continue; }
    const length = readLength(br, t1, t2, t3);
    if (length === undefined) break;
    if (length === -1) continue;
    const off = length === 2 ? br.byte() : (readOffsetHigh(br, toff) << 8) | br.byte();
    if (off === 0 || off > n) throw new Error(`bad match offset ${off} at ${n}`);
    const start = n - off;
    for (let i = 0; i < length; i++) push(out[start + i]!);
  }

  const relocs: UnpackedExe['relocs'] = [];
  let seg = 0;
  for (;;) {
    const count = br.word();
    if (count === 0xFFFF) break;
    if (count === 0) { seg += 0x0FFF; continue; }
    for (let i = 0; i < count; i++) relocs.push({ segment: seg, offset: br.word() });
  }
  const ss = br.word(), sp = br.word(), cs = br.word(), ip = br.word();
  return { image: out.slice(0, n), relocs, ss, sp, cs, ip };
}
