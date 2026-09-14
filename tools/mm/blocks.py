"""ROUNDrBR.CT (72 B/block: 6x6 LE16 tile words), .COL (18 B/block), .DIR (36 B/block), .LEV (1 B/block)."""
from dataclasses import dataclass
import struct

@dataclass
class Blocks:
    tiles: list   # per block: 36 ints (tile word, bit 15 = priority)
    col: list     # per block: 18 raw bytes
    dir: list     # per block: 36 raw bytes
    lev: list     # per block: 1 byte (may be shorter/longer in the files)

def decode_blocks(ct: bytes, col: bytes, dir_: bytes, lev: bytes) -> Blocks:
    if len(ct) % 72:
        raise ValueError("CT size not a multiple of 72")
    n = len(ct) // 72
    if len(col) != n * 18:
        raise ValueError(f"COL size {len(col)} != {n}*18")
    tiles = [list(struct.unpack_from('<36H', ct, i * 72)) for i in range(n)]
    colb = [list(col[i * 18:(i + 1) * 18]) for i in range(n)]
    dirb = [list(dir_[i * 36:(i + 1) * 36]) for i in range(n)]   # ROUND5 short / ROUND8 long: pad/ignore
    dirb = [d + [0] * (36 - len(d)) for d in dirb]
    levb = list(lev[:n]) + [0] * max(0, n - len(lev))
    return Blocks(tiles, colb, dirb, levb)

def expand_map(blocks: Blocks, map_blocks: list):
    """192x192 tile words as the game builds them (fn 447e)."""
    out = [[0] * 192 for _ in range(192)]
    nblk = len(blocks.tiles)
    for i, b in enumerate(map_blocks):
        if (b & 0x3F) >= nblk:
            continue        # the game would read stale memory past the CT here (ROUND82 has such cells)
        t = blocks.tiles[b & 0x3F]
        bx, by = i % 32, i // 32
        for r in range(6):
            out[by * 6 + r][bx * 6:bx * 6 + 6] = t[r * 6:r * 6 + 6]
    return out
