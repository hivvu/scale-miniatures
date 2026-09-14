"""PKLITE 1.15 (extra compression, large model) depacker, transliterated from the MICRO.EXE stub.

Stub layout (image offsets, image = file minus 0x60-byte MZ header):
  0x000  loader: memory check, relocate decompressor to top of memory
  0x034  XOR-chain decryptor: 0x136 words from 0x2B2 downwards, plain = c[i] ^ c[i+1], seed 0x070C
  0x058  decompressor (runs at seg:0000; tables at decompressor-relative 0x21D/0x228/0x233/0x243)
  0x2C0  compressed bitstream, then relocations, then SS SP CS IP

Bitstream: 16-bit LE words, LSB first. Flag bit 0 = literal (byte ^ remaining-bit-counter),
flag bit 1 = match. Lengths from a prefix tree with escape 0x19 (+ raw byte; 0xFE = pointer
normalisation no-op, 0xFF = end). Offsets: high byte from a prefix tree, low byte raw.
Relocations after the end marker: [count][offset*count] blocks; count 0 advances the segment by
0x0FFF paragraphs; 0xFFFF terminates. Then SS, SP, CS, IP words (segments relative to load seg).
"""
from dataclasses import dataclass, field
import struct

HEADER_LEN = 0x60
COMPRESSED_START = 0x2C0
DECRYPT_TOP = 0x2B2
DECRYPT_WORDS = 0x136
DECRYPT_SEED = 0x070C
DECOMP_BASE = 0x58


@dataclass
class Unpacked:
    image: bytes
    relocs: list                  # list of (segment, offset)
    ss: int
    sp: int
    cs: int
    ip: int
    minalloc: int = 0
    notes: dict = field(default_factory=dict)


class BitReader:
    def __init__(self, data: bytes, pos: int):
        self.data = data
        self.pos = pos
        self.buf = 0
        self.left = 0
        self._reload()

    def _reload(self):
        self.buf = self.data[self.pos] | (self.data[self.pos + 1] << 8)
        self.pos += 2
        self.left = 16

    def bit(self) -> int:
        b = self.buf & 1
        self.buf >>= 1
        self.left -= 1
        if self.left == 0:
            self._reload()
        return b

    def byte(self) -> int:
        v = self.data[self.pos]
        self.pos += 1
        return v

    def word(self) -> int:
        v = self.data[self.pos] | (self.data[self.pos + 1] << 8)
        self.pos += 2
        return v


def decrypt_stub(image: bytearray) -> None:
    prev = DECRYPT_SEED
    off = DECRYPT_TOP
    for _ in range(DECRYPT_WORDS):
        w = image[off] | (image[off + 1] << 8)
        p = w ^ prev
        image[off] = p & 0xFF
        image[off + 1] = p >> 8
        prev = w
        off -= 2


def _tables(image: bytes):
    t1 = image[DECOMP_BASE + 0x21D: DECOMP_BASE + 0x21D + 16]
    t2 = image[DECOMP_BASE + 0x228: DECOMP_BASE + 0x228 + 16]
    t3 = image[DECOMP_BASE + 0x233: DECOMP_BASE + 0x233 + 16]
    toff = image[DECOMP_BASE + 0x243: DECOMP_BASE + 0x243 + 32]
    return t1, t2, t3, toff


def _read_length(br: BitReader, t1, t2, t3):
    """Returns length, or None for end-of-data, or -1 for the 0xFE no-op."""
    bx = br.bit()
    bx = (bx << 1) | br.bit()
    if bx >= 2:
        return bx                          # codes 10, 11 -> 2, 3
    bx = (bx << 1) | br.bit()
    if bx == 0:
        return t1[0]                       # 4
    bx = (bx << 1) | br.bit()
    if bx < 5:
        return t1[bx]                      # 5, 6, 7
    bx = (bx << 1) | br.bit()
    if bx <= 0xC:
        return t1[bx]                      # 8, 9, 10
    # bx in 13..15
    bx &= 3
    bx = (bx << 1) | br.bit()
    if bx < 5:
        cl = t2[bx]                        # 11, 12, 0x19
    else:
        bx = (bx << 1) | br.bit()
        if bx <= 0xC:
            cl = t2[bx]                    # 13, 14, 15
        else:
            bx &= 3
            bx = (bx << 1) | br.bit()
            if bx < 5:
                cl = t3[bx]                # 16, 17, 18
            else:
                bx = (bx << 1) | br.bit()
                cl = t3[bx]                # 19..24
    if cl != 0x19:
        return cl
    al = br.byte()
    if al >= 0xFE:
        return None if al == 0xFF else -1
    return 0x19 + al


def _read_offset_high(br: BitReader, toff) -> int:
    if br.bit():
        return 0
    bx = 0
    for _ in range(3):
        bx = (bx << 1) | br.bit()
    if bx < 2:
        return toff[bx]
    bx = (bx << 1) | br.bit()
    if bx < 8:
        return toff[bx]
    bx = (bx << 1) | br.bit()
    if bx < 0x17:
        return toff[bx]
    bx = (bx << 1) | br.bit()
    return bx & 0xDF


def unpack(data: bytes) -> Unpacked:
    if data[:2] != b"MZ":
        raise ValueError("not an MZ executable")
    cparhdr = struct.unpack_from("<H", data, 8)[0]
    hdr = cparhdr * 16
    if hdr != HEADER_LEN or data[0x1C] != 0x0F or data[0x1D] & 0x30 != 0x30:
        raise ValueError("expected PKLITE 1.15 with extra compression + large model")
    image = bytearray(data[hdr:])
    decrypt_stub(image)
    t1, t2, t3, toff = _tables(image)

    out = bytearray()
    br = BitReader(image, COMPRESSED_START)
    while True:
        if br.bit() == 0:
            out.append(br.byte() ^ (br.left & 0xFF))
            continue
        length = _read_length(br, t1, t2, t3)
        if length is None:
            break
        if length == -1:
            continue
        if length == 2:
            off = br.byte()
        else:
            off = (_read_offset_high(br, toff) << 8) | br.byte()
        if off == 0 or off > len(out):
            raise ValueError(f"bad match offset {off} at out {len(out)}")
        start = len(out) - off
        for i in range(length):
            out.append(out[start + i])

    # relocations
    relocs = []
    seg = 0
    while True:
        count = br.word()
        if count == 0xFFFF:
            break
        if count == 0:
            seg += 0x0FFF
            continue
        for _ in range(count):
            relocs.append((seg, br.word()))
    ss = br.word(); sp = br.word(); cs = br.word(); ip = br.word()

    # memory: stub asks for 0x7DA9 paragraphs above the load segment; use that as minalloc bound
    total_paras = struct.unpack_from("<H", image, 1)[0]
    image_paras = (len(out) + 15) // 16
    # UNP 4.11 reserves 0x1D paragraphs more than the stub's request; match it so DOS memory layout
    # is identical between our output and UNP's.
    minalloc = max(0, total_paras - image_paras + 0x1D)
    return Unpacked(bytes(out), relocs, ss, sp, cs, ip, minalloc,
                    {"compressed_end": br.pos, "total_paras": total_paras})


def build_mz(u: Unpacked) -> bytes:
    """Assemble a plain MZ file: 32-byte fixed header + relocation table padded to a paragraph."""
    reloc_bytes = b"".join(struct.pack("<HH", off, seg) for seg, off in u.relocs)
    hdr_len = 0x20 + len(reloc_bytes)
    hdr_len = (hdr_len + 15) & ~15
    total = hdr_len + len(u.image)
    pages = (total + 511) // 512
    cblp = total % 512
    header = struct.pack("<2sHHHHHHHHHHHHH", b"MZ", cblp, pages, len(u.relocs), hdr_len // 16,
                         u.minalloc, 0xFFFF, u.ss, u.sp, 0, u.ip, u.cs, 0x20, 0)
    header += b"\0" * (0x20 - len(header))          # relocation table starts at e_lfarlc = 0x20
    body = header + reloc_bytes
    body += b"\0" * (hdr_len - len(body))
    return body + u.image


if __name__ == "__main__":
    import sys
    src, dst = sys.argv[1], sys.argv[2]
    u = unpack(open(src, "rb").read())
    open(dst, "wb").write(build_mz(u))
    print(f"image {len(u.image)} bytes, {len(u.relocs)} relocs, CS:IP={u.cs:04X}:{u.ip:04X} "
          f"SS:SP={u.ss:04X}:{u.sp:04X} minalloc={u.minalloc:#x} stream end {u.notes['compressed_end']:#x}")
