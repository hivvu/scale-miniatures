"""Codemasters LZ codec used by Micro Machines (.PI*, .PH0, .PR*, .VH0), transliterated from
MICRO_U.EXE fn 1000:3333 (register-level, including its quirks).

Model: one 64 KB work segment (DS = ES). Compressed input is loaded at 0xC000, output starts at 0.
Stream = flag byte (8 bits, MSB first: 0 = literal byte follows in stream, 1 = command byte) ...
Command byte c:
  0x00-0x0E  literal run of c+8 bytes; 0x0F: ext byte b -> run of b+0x1E bytes, or b==0xFF ->
             16-bit count follows. After a literal run the NEXT token is another command byte
             (no flag bit is consumed).
  0x10-0x1E  repeat previous output byte (c-0x0E) times; 0x1F: ext byte b -> (b+0x11) times
             (9-bit count, carry into CH).
  0x20-0x4F  match: len = (c & 0xF) + 3, off = (((c>>4)-2) << 8) | b, src = out_pos - off - 2.
  0x50-0x5E  match: off = ((c-0x50) << 8) | b1, len = b2 + 4, src = out_pos - off - 1.
  0x5F       match: off = (b0 << 8) | b1, len = b2 + 4, src = out_pos - off - 1.
  0x60-0x6F  reverse copy: (c-0x60+3) bytes read backwards starting at out_pos - b - 1
             (mirrors a run; used heavily by the symmetric vehicle sprites).
  0x70-0x7E  incrementing run: prev byte +1, +2, ... for (c-0x6E) bytes; 0x7F: ext b -> (b+0x11) bytes.
  0x80-0xFE  short match: n = ((c>>5)&3)+1, len = n+1, off = (c & 0x1F) + n, src = out_pos - off - 1.
  0xFF       end of stream. Returns (output length hi byte, lo byte); the intro loader copies only
             (len & 0xFF00) bytes (fn 3547 uses BX with BL=0).
Confidence: transliterated from disassembly; validated against the game's memory (ROUND2BR.VH0 sprite
table dumped from DOSBox-X, 32/32 frames identical) and by decoding all 46 files to EOF.
"""
from dataclasses import dataclass

INPUT_OFFSET = 0xC000
SEG = 0x10000


@dataclass
class LzResult:
    data: bytes          # full decoded output (len bytes)
    length: int          # output length as the routine computes it (16-bit)
    consumed: int        # input bytes consumed including the 0xFF terminator


def decode(comp: bytes, zero_fill: bool = True) -> LzResult:
    if len(comp) > SEG - INPUT_OFFSET:
        raise ValueError("compressed input larger than 16 KB does not fit the work segment")
    mem = bytearray(SEG)
    mem[INPUT_OFFSET:INPUT_OFFSET + len(comp)] = comp
    si = INPUT_OFFSET   # input pointer
    di = 0              # output pointer

    def rd():
        nonlocal si
        v = mem[si]
        si = (si + 1) & 0xFFFF
        return v

    def copy_from(src, n):
        nonlocal di
        for _ in range(n):
            mem[di] = mem[src & 0xFFFF]
            src += 1
            di = (di + 1) & 0xFFFF

    def literal(n):
        nonlocal si, di
        for _ in range(n):
            mem[di] = mem[si]
            si = (si + 1) & 0xFFFF
            di = (di + 1) & 0xFFFF

    def command():
        """Returns False at end of stream. Handles chained literal runs internally."""
        nonlocal si, di
        while True:
            c = mem[si]
            if c >= 0x80:
                if c == 0xFF:
                    si = (si + 1) & 0xFFFF
                    return False
                n = ((c & 0x60) >> 5) + 1
                off = (c & 0x1F) + n
                si = (si + 1) & 0xFFFF
                copy_from(di - off - 1, n + 1)
                return True
            si = (si + 1) & 0xFFFF
            if c >= 0x70:
                if c == 0x7F:
                    cnt = (rd() + 0x11) & 0xFF
                else:
                    cnt = (c - 0x6E) & 0xFF
                val = mem[(di - 1) & 0xFFFF]
                for _ in range(cnt or 256):
                    val = (val + 1) & 0xFF
                    mem[di] = val
                    di = (di + 1) & 0xFFFF
                return True
            if c >= 0x60:
                # reverse (mirrored) copy, fn 34ac: out[di+k] = out[di - b - 1 - k]
                cnt = c - 0x60 + 3
                b = rd()
                src = di - b - 1
                for _ in range(cnt):
                    mem[di] = mem[src & 0xFFFF]
                    src -= 1
                    di = (di + 1) & 0xFFFF
                return True
            if c >= 0x50:
                hi = rd() if c == 0x5F else c - 0x50
                lo = rd()
                ln = rd() + 4
                copy_from(di - ((hi << 8) | lo) - 1, ln)
                return True
            if c >= 0x20:
                hi = ((c >> 4) - 2) & 3
                b = rd()
                copy_from(di - ((hi << 8) | b) - 2, (c & 0xF) + 3)
                return True
            if c >= 0x10:
                if c == 0x1F:
                    cnt = rd() + 0x11          # may exceed 255 (carry into CH)
                else:
                    cnt = c - 0x0E
                copy_from(di - 1, cnt)
                return True
            # 0x00-0x0F: literal run(s); next token is another command byte
            if c == 0x0F:
                b = rd()
                if b == 0xFF:
                    cnt = rd() | (rd() << 8)
                else:
                    cnt = b + 0x1E
            else:
                cnt = c + 8
            literal(cnt)
            # loop: read next command byte directly

    running = True
    while running:
        flags = rd()
        al = ((flags << 1) | 1) & 0x1FF     # adc al,al with CF=1 (sentinel in bit 0)
        cf = al >> 8
        al &= 0xFF
        while True:
            if cf:
                if al == 0:                 # sentinel shifted out: new flag byte
                    break
                if not command():
                    running = False
                    break
            else:
                literal(1)
            al <<= 1
            cf = al >> 8
            al &= 0xFF
    length = di & 0xFFFF
    return LzResult(bytes(mem[:length]), length, si - INPUT_OFFSET)


def loader_copy_length(length: int) -> int:
    """fn 3547 copies BX = (length & 0xFF00) bytes (BL is left as 0)."""
    return length & 0xFF00
