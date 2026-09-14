"""ROUNDrt.MAP (2048 B): plane 0 = 32x32 block indices (& 0x3F), plane 1 = 32x32 progress bytes."""
from dataclasses import dataclass

@dataclass
class TileMap:
    blocks: list      # 1024 ints (raw bytes)
    progress: list    # 1024 ints

    def block(self, bx, by): return self.blocks[by * 32 + bx] & 0x3F

def decode_tilemap(data: bytes) -> TileMap:
    if len(data) != 2048:
        raise ValueError(f".MAP must be 2048 bytes, got {len(data)}")
    return TileMap(list(data[:1024]), list(data[1024:]))
