/**
 * Codemasters LZ codec used by Micro Machines (.PI*, .PH0, .PR*, .VH0). Literal port of tools/mm/lz.py,
 * itself a register-level transliteration of MICRO_U.EXE fn 1000:3333 (see re/notes/formats/LZ.md).
 *
 * Model: one 64 KB work segment; compressed input at 0xC000, output from 0. Decoding happens in place, so
 * long matches may read bytes that were just written (and, for the loader's stale-window quirk, whatever the
 * segment held before, which here is zero).
 */
export interface LzResult {
  data: Uint8Array;   // decoded bytes (length = `length`)
  length: number;     // output length as the 16-bit routine computes it
  consumed: number;   // input bytes consumed including the 0xFF terminator
}

const INPUT_OFFSET = 0xC000;
const SEG = 0x10000;

export function lzDecode(comp: Uint8Array): LzResult {
  if (comp.length > SEG - INPUT_OFFSET) throw new Error('compressed input larger than 16 KB does not fit the work segment');
  const mem = new Uint8Array(SEG);
  mem.set(comp, INPUT_OFFSET);
  let si = INPUT_OFFSET;
  let di = 0;

  const rd = (): number => { const v = mem[si]!; si = (si + 1) & 0xFFFF; return v; };
  const copyFrom = (src: number, n: number): void => {
    for (let i = 0; i < n; i++) { mem[di] = mem[src & 0xFFFF]!; src++; di = (di + 1) & 0xFFFF; }
  };
  const literal = (n: number): void => {
    for (let i = 0; i < n; i++) { mem[di] = mem[si]!; si = (si + 1) & 0xFFFF; di = (di + 1) & 0xFFFF; }
  };

  /** One command token (chained literal runs handled inside). Returns false at end of stream. */
  const command = (): boolean => {
    for (;;) {
      const c = mem[si]!;
      if (c >= 0x80) {
        if (c === 0xFF) { si = (si + 1) & 0xFFFF; return false; }
        const n = ((c & 0x60) >> 5) + 1;
        const off = (c & 0x1F) + n;
        si = (si + 1) & 0xFFFF;
        copyFrom(di - off - 1, n + 1);
        return true;
      }
      si = (si + 1) & 0xFFFF;
      if (c >= 0x70) {                                   // incrementing run
        const cnt = c === 0x7F ? (rd() + 0x11) & 0xFF : (c - 0x6E) & 0xFF;
        let val = mem[(di - 1) & 0xFFFF]!;
        for (let i = 0; i < (cnt || 256); i++) { val = (val + 1) & 0xFF; mem[di] = val; di = (di + 1) & 0xFFFF; }
        return true;
      }
      if (c >= 0x60) {                                   // reverse (mirrored) copy, fn 34ac
        const cnt = c - 0x60 + 3;
        const b = rd();
        let src = di - b - 1;
        for (let i = 0; i < cnt; i++) { mem[di] = mem[src & 0xFFFF]!; src--; di = (di + 1) & 0xFFFF; }
        return true;
      }
      if (c >= 0x50) {                                   // long match, 16-bit offset
        const hi = c === 0x5F ? rd() : c - 0x50;
        const lo = rd();
        const ln = rd() + 4;
        copyFrom(di - ((hi << 8) | lo) - 1, ln);
        return true;
      }
      if (c >= 0x20) {                                   // match len 3..18, offset <= 0x2FF
        const hi = ((c >> 4) - 2) & 3;
        const b = rd();
        copyFrom(di - ((hi << 8) | b) - 2, (c & 0xF) + 3);
        return true;
      }
      if (c >= 0x10) {                                   // repeat previous byte
        const cnt = c === 0x1F ? rd() + 0x11 : c - 0x0E;
        copyFrom(di - 1, cnt);
        return true;
      }
      // 0x00-0x0F: literal run(s); the next token is another command byte (no flag bit)
      let cnt: number;
      if (c === 0x0F) {
        const b = rd();
        cnt = b === 0xFF ? rd() | (rd() << 8) : b + 0x1E;
      } else cnt = c + 8;
      literal(cnt);
    }
  };

  let running = true;
  while (running) {
    const flags = rd();
    let al = ((flags << 1) | 1) & 0x1FF;               // adc al,al with CF=1 (sentinel in bit 0)
    let cf = al >> 8;
    al &= 0xFF;
    for (;;) {
      if (cf) {
        if (al === 0) break;                             // sentinel shifted out: new flag byte
        if (!command()) { running = false; break; }
      } else literal(1);
      al <<= 1;
      cf = al >> 8;
      al &= 0xFF;
    }
  }
  const length = di & 0xFFFF;
  return { data: mem.slice(0, length), length, consumed: si - INPUT_OFFSET };
}

/** fn 3547 copies BX = (length & 0xFF00) bytes into the destination bank (BL is left as 0). */
export function loaderCopyLength(length: number): number { return length & 0xFF00; }
